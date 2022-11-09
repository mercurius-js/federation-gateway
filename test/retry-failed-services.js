'use strict'

const { test, t } = require('tap')
const Fastify = require('fastify')
const { GraphQLSchema } = require('graphql')
const GQL = require('mercurius')
const FakeTimers = require('@sinonjs/fake-timers')
const plugin = require('../index')
const { buildFederationSchema } = require('@mercuriusjs/federation')

async function createTestService (port, schema, resolvers = {}) {
  const service = Fastify()
  service.register(GQL, {
    schema: buildFederationSchema(schema),
    resolvers
  })
  await service.listen({ port })
  return service
}

const users = {
  u1: {
    id: 'u1',
    name: 'John'
  },
  u2: {
    id: 'u2',
    name: 'Jane'
  }
}

const posts = {
  p1: {
    pid: 'p1',
    title: 'Post 1',
    content: 'Content 1',
    authorId: 'u1'
  },
  p2: {
    pid: 'p2',
    title: 'Post 2',
    content: 'Content 2',
    authorId: 'u2'
  },
  p3: {
    pid: 'p3',
    title: 'Post 3',
    content: 'Content 3',
    authorId: 'u1'
  },
  p4: {
    pid: 'p4',
    title: 'Post 4',
    content: 'Content 4',
    authorId: 'u1'
  }
}

const userService = {
  schema: `
  extend type Query {
    me: User
  }
  
  type User @key(fields: "id") {
    id: ID!
    name: String!
  }
  `,
  resolvers: {
    Query: {
      me: () => {
        return users.u1
      }
    },
    User: {
      __resolveReference: user => {
        return users[user.id]
      }
    }
  }
}

const postService = {
  schema: `
  type Post @key(fields: "pid") {
    pid: ID!
    title: String
    content: String
    author: User @requires(fields: "pid title")
  }

  type User @key(fields: "id") @extends {
    id: ID! @external
    name: String @external
    posts(count: Int): [Post]
  }
`,
  resolvers: {
    Post: {
      author: post => {
        return {
          __typename: 'User',
          id: post.authorId
        }
      }
    },
    User: {
      posts: (user, { count }) => {
        return Object.values(posts)
          .filter(p => p.authorId === user.id)
          .slice(0, count)
      }
    }
  }
}

t.beforeEach(({ context }) => {
  context.clock = FakeTimers.install({
    shouldClearNativeTimers: true,
    shouldAdvanceTime: true,
    advanceTimeDelta: 100
  })
})

t.afterEach(({ context }) => {
  context.clock.uninstall()
})

test('gateway - retry mandatory failed services on startup', async t => {
  t.plan(5)
  const service1 = await createTestService(
    0,
    userService.schema,
    userService.resolvers
  )

  let service2 = null
  t.context.clock.setTimeout(async () => {
    service2 = await createTestService(
      5113,
      postService.schema,
      postService.resolvers
    )
  }, 5000)

  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await service1.close()
    await service2.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'user',
          url: `http://localhost:${service1.server.address().port}/graphql`,
          mandatory: false
        },
        {
          name: 'post',
          url: 'http://localhost:5113/graphql',
          mandatory: true
        }
      ]
    },
    jit: 1
  })

  gateway.graphql.addHook(
    'onGatewayReplaceSchema',
    async (instance, schema) => {
      t.type(instance, 'object')
      t.type(schema, GraphQLSchema)
      t.ok('should be called')
    }
  )

  await gateway.ready()

  const query = `
    query {
      user: me {
        id
        name
        posts(count: 1) {
          pid
        }
      }
    }`

  const res = await gateway.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.same(await res.json(), {
    errors: [
      {
        message: 'Cannot query field "posts" on type "User".',
        locations: [{ line: 6, column: 9 }]
      }
    ],
    data: null
  })

  for (let i = 0; i < 100; i++) {
    await t.context.clock.tickAsync(100)
  }

  const res1 = await gateway.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.same(JSON.parse(res1.body), {
    data: {
      user: {
        id: 'u1',
        name: 'John',
        posts: [
          {
            pid: 'p1'
          }
        ]
      }
    }
  })
})

test('gateway - should not call onGatewayReplaceSchemaHandler if the hook is not specified', async t => {
  t.plan(2)
  const service1 = await createTestService(
    0,
    userService.schema,
    userService.resolvers
  )

  let service2 = null
  t.context.clock.setTimeout(async () => {
    service2 = await createTestService(
      5111,
      postService.schema,
      postService.resolvers
    )
  }, 2000)

  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await service1.close()
    await service2.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'user',
          url: `http://localhost:${service1.server.address().port}/graphql`,
          mandatory: false
        },
        {
          name: 'post',
          url: 'http://localhost:5111/graphql',
          mandatory: true
        }
      ],
      retryServicesCount: 10,
      retryServicesInterval: 2000
    },
    jit: 1
  })

  await gateway.ready()

  const query = `
    query {
      user: me {
        id
        name
        posts(count: 1) {
          pid
        }
      }
    }`

  const res = await gateway.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.same(await res.json(), {
    errors: [
      {
        message: 'Cannot query field "posts" on type "User".',
        locations: [{ line: 6, column: 9 }]
      }
    ],
    data: null
  })

  for (let i = 0; i < 100; i++) {
    await t.context.clock.tickAsync(100)
  }

  const res1 = await gateway.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.same(JSON.parse(res1.body), {
    data: {
      user: {
        id: 'u1',
        name: 'John',
        posts: [
          {
            pid: 'p1'
          }
        ]
      }
    }
  })
})

test('gateway - dont retry non-mandatory failed services on startup', async t => {
  t.plan(2)
  const service1 = await createTestService(
    0,
    userService.schema,
    userService.resolvers
  )

  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await service1.close()
    t.context.clock.uninstall()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'user',
          url: `http://localhost:${service1.server.address().port}/graphql`,
          mandatory: false
        },
        {
          name: 'post',
          url: 'http://localhost:5112/graphql',
          mandatory: false
        }
      ],
      pollingInterval: 2000
    },
    jit: 1
  })

  await gateway.ready()

  const query = `
    query {
      user: me {
        id
        name
        posts(count: 1) {
          pid
        }
      }
    }`

  const res = await gateway.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.same(await res.json(), {
    errors: [
      {
        message: 'Cannot query field "posts" on type "User".',
        locations: [{ line: 6, column: 9 }]
      }
    ],
    data: null
  })

  for (let i = 0; i < 100; i++) {
    await t.context.clock.tickAsync(150)
  }

  const res1 = await gateway.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.same(await res1.json(), {
    errors: [
      {
        message: 'Cannot query field "posts" on type "User".',
        locations: [{ line: 6, column: 9 }]
      }
    ],
    data: null
  })
})

test('gateway - should log error if retry throws', async t => {
  t.plan(1)
  const service1 = await createTestService(
    0,
    userService.schema,
    userService.resolvers
  )

  let service2 = null
  t.context.clock.setTimeout(async () => {
    service2 = await createTestService(
      5114,
      postService.schema,
      postService.resolvers
    )
  }, 2000)

  const gateway = Fastify()

  let errCount = 0
  gateway.log.error = error => {
    if (error.message.includes('kaboom') && errCount === 0) {
      errCount++
      t.pass()
    }
  }

  t.teardown(async () => {
    await gateway.close()
    await service1.close()
    await service2.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'user',
          url: `http://localhost:${service1.server.address().port}/graphql`,
          mandatory: false
        },
        {
          name: 'post',
          url: 'http://localhost:5114/graphql',
          mandatory: true
        }
      ],
      retryServicesCount: 1,
      retryServicesInterval: 3000
    },
    jit: 1
  })

  gateway.graphql.addHook('onGatewayReplaceSchema', async () => {
    throw new Error('kaboom')
  })

  await gateway.ready()

  for (let i = 0; i < 200; i++) {
    await t.context.clock.tickAsync(50)
  }
})

test('gateway - stop retrying after no. of retries exceeded', async t => {
  t.plan(1)
  const service1 = await createTestService(
    0,
    userService.schema,
    userService.resolvers
  )

  const gateway = Fastify()

  let errCount = 0
  gateway.log.error = error => {
    if (error.code === 'MER_ERR_GQL_GATEWAY_REFRESH' && errCount === 0) {
      errCount++
      t.pass()
    }
  }

  t.teardown(async () => {
    await gateway.close()
    await service1.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'user',
          url: `http://localhost:${service1.server.address().port}/graphql`,
          mandatory: false
        },
        {
          name: 'post',
          url: 'http://localhost:5115/graphql',
          mandatory: true
        }
      ],
      retryServicesCount: 1,
      retryServicesInterval: 2000
    },
    jit: 1
  })

  await gateway.ready()

  for (let i = 0; i < 100; i++) {
    await t.context.clock.tickAsync(150)
  }
})
