'use strict'

const { test, t } = require('tap')

const FakeTimers = require('@sinonjs/fake-timers')

const { once } = require('events')
const { promisify } = require('util')
const immediate = promisify(setImmediate)

const Fastify = require('fastify')
const WebSocket = require('ws')
const { buildFederationSchema } = require('@mercuriusjs/federation')
const GQL = require('mercurius')
const plugin = require('../index')

t.beforeEach(({ context }) => {
  context.clock = FakeTimers.install({
    shouldClearNativeTimers: true,
    shouldAdvanceTime: true,
    advanceTimeDelta: 40
  })
})

t.afterEach(({ context }) => {
  context.clock.uninstall()
})

test('Polling schemas with disable cache', async t => {
  const resolvers = {
    Query: {
      me: () => user
    },
    User: {
      __resolveReference: user => user
    }
  }

  const user = {
    id: 'u1',
    name: 'John',
    lastName: 'Doe'
  }

  const userService = Fastify()
  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await userService.close()
  })

  userService.register(GQL, {
    schema: buildFederationSchema(`
      extend type Query {
        me: User
      }

      type User @key(fields: "id") {
        id: ID!
        name: String!
      }
    `),
    resolvers
  })

  await userService.listen({ port: 0 })

  const userServicePort = userService.server.address().port

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'user',
          url: `http://localhost:${userServicePort}/graphql`
        }
      ],
      pollingInterval: 2000,
      cache: false
    }
  })

  const res = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({
      query: `
        query MainQuery {
          me {
            id
            name
          }
        }
      `
    })
  })

  t.same(JSON.parse(res.body), {
    data: {
      me: {
        id: 'u1',
        name: 'John'
      }
    }
  })
})

test('Polling schemas', async t => {
  const resolvers = {
    Query: {
      me: () => user
    },
    User: {
      __resolveReference: user => user
    }
  }

  const user = {
    id: 'u1',
    name: 'John',
    lastName: 'Doe'
  }

  const userService = Fastify()
  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await userService.close()
  })

  userService.register(GQL, {
    schema: buildFederationSchema(`
      extend type Query {
        me: User
      }

      type User @key(fields: "id") {
        id: ID!
        name: String!
      }
    `),
    resolvers
  })

  await userService.listen({ port: 0 })

  const userServicePort = userService.server.address().port

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'user',
          url: `http://localhost:${userServicePort}/graphql`
        }
      ],
      pollingInterval: 2000
    }
  })

  const res = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({
      query: `
        query MainQuery {
          me {
            id
            name
          }
        }
      `
    })
  })

  t.same(JSON.parse(res.body), {
    data: {
      me: {
        id: 'u1',
        name: 'John'
      }
    }
  })

  const res2 = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({
      query: `
        query MainQuery {
          me {
            id
            name
            lastName
          }
        }
      `
    })
  })

  t.same(JSON.parse(res2.body), {
    errors: [
      {
        message:
          'Cannot query field "lastName" on type "User". Did you mean "name"?',
        locations: [{ line: 6, column: 13 }]
      }
    ],
    data: null
  })

  userService.graphql.replaceSchema(
    buildFederationSchema(`
      extend type Query {
        me: User
      }

      type User @key(fields: "id") {
        id: ID!
        name: String!
        lastName: String!
      }
    `)
  )
  userService.graphql.defineResolvers(resolvers)

  for (let i = 0; i < 10; i++) {
    await t.context.clock.tickAsync(200)
  }

  // We need the event loop to actually spin twice to
  // be able to propagate the change
  await immediate()
  await immediate()

  const res3 = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({
      query: `
        query MainQuery {
          me {
            id
            name
            lastName
          }
        }
      `
    })
  })

  t.same(JSON.parse(res3.body), {
    data: {
      me: {
        id: 'u1',
        name: 'John',
        lastName: 'Doe'
      }
    }
  })
})

test('Polling schemas (gateway.polling interval is not a number)', async t => {
  const resolvers = {
    Query: {
      me: () => user
    },
    User: {
      __resolveReference: user => user
    }
  }

  const user = {
    id: 'u1',
    name: 'John',
    lastName: 'Doe'
  }

  const userService = Fastify()
  const gateway = Fastify({
    log: {
      warn () {
        t.pass()
      }
    }
  })

  t.teardown(async () => {
    await gateway.close()
    await userService.close()
  })

  userService.register(GQL, {
    schema: buildFederationSchema(`
      extend type Query {
        me: User
      }

      type User @key(fields: "id") {
        id: ID!
        name: String!
      }
    `),
    resolvers
  })

  await userService.listen({ port: 0 })

  const userServicePort = userService.server.address().port

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'user',
          url: `http://localhost:${userServicePort}/graphql`
        }
      ],
      pollingInterval: '2000'
    }
  })

  await gateway.listen({ port: 0 })
})

test("Polling schemas (if service is down, schema shouldn't be changed)", async t => {
  const resolvers = {
    Query: {
      me: () => user
    },
    User: {
      __resolveReference: user => user
    }
  }

  const user = {
    id: 'u1',
    name: 'John',
    lastName: 'Doe'
  }

  const userService = Fastify({ forceCloseConnections: true })
  const gateway = Fastify()

  t.teardown(async () => {
    await gateway.close()
    await userService.close()
  })

  userService.register(GQL, {
    schema: buildFederationSchema(`
      extend type Query {
        me: User
      }

      type User @key(fields: "id") {
        id: ID!
        name: String!
      }
    `),
    resolvers
  })

  await userService.listen({ port: 0 })
  await t.context.clock.tickAsync()

  const userServicePort = userService.server.address().port

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'user',
          url: `http://127.0.0.1:${userServicePort}/graphql`
        }
      ],
      pollingInterval: 500
    }
  })

  await t.context.clock.tickAsync()

  {
    const { body } = await gateway.inject({
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      url: '/graphql',
      body: JSON.stringify({
        query: `
          query MainQuery {
            me {
              id
              name
            }
          }
        `
      })
    })

    await t.context.clock.tickAsync()

    t.same(JSON.parse(body), {
      data: {
        me: {
          id: 'u1',
          name: 'John'
        }
      }
    })
  }

  {
    const { body } = await gateway.inject({
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      url: '/graphql',
      body: JSON.stringify({
        query: `
          query MainQuery {
            me {
              id
              name
              lastName
            }
          }
        `
      })
    })

    t.same(JSON.parse(body), {
      errors: [
        {
          message:
            'Cannot query field "lastName" on type "User". Did you mean "name"?',
          locations: [{ line: 6, column: 15 }]
        }
      ],
      data: null
    })
  }

  await userService.close()
  await t.context.clock.tickAsync(500)

  {
    const { body } = await gateway.inject({
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      url: '/graphql',
      body: JSON.stringify({
        query: `
          query MainQuery {
            me {
              id
              name
              lastName
            }
          }
        `
      })
    })

    t.same(JSON.parse(body), {
      errors: [
        {
          message:
            'Cannot query field "lastName" on type "User". Did you mean "name"?',
          locations: [{ line: 6, column: 15 }]
        }
      ],
      data: null
    })
  }
})

test('Polling schemas (if service is mandatory, exception should be thrown)', async t => {
  const resolvers = {
    Query: {
      me: () => user
    },
    User: {
      __resolveReference: user => user
    }
  }

  const user = {
    id: 'u1',
    name: 'John',
    lastName: 'Doe'
  }

  const userService = Fastify()
  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await userService.close()
  })

  userService.register(GQL, {
    schema: buildFederationSchema(`
      extend type Query {
        me: User
      }

      type User @key(fields: "id") {
        id: ID!
        name: String!
      }
    `),
    resolvers
  })

  await userService.listen({ port: 0 })

  const userServicePort = userService.server.address().port

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'user',
          url: `http://localhost:${userServicePort}/graphql`,
          mandatory: true
        }
      ]
    }
  })

  {
    const { body } = await gateway.inject({
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      url: '/graphql',
      body: JSON.stringify({
        query: `
          query MainQuery {
            me {
              id
              name
            }
          }
        `
      })
    })

    t.same(JSON.parse(body), {
      data: {
        me: {
          id: 'u1',
          name: 'John'
        }
      }
    })
  }

  {
    const { body } = await gateway.inject({
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      url: '/graphql',
      body: JSON.stringify({
        query: `
          query MainQuery {
            me {
              id
              name
              lastName
            }
          }
        `
      })
    })

    t.same(JSON.parse(body), {
      errors: [
        {
          message:
            'Cannot query field "lastName" on type "User". Did you mean "name"?',
          locations: [{ line: 6, column: 15 }]
        }
      ],
      data: null
    })
  }

  gateway.graphqlGateway.close()
  await userService.close()

  t.rejects(async () => {
    await gateway.graphqlGateway.refresh()
  })
})

test('Polling schemas (cache should be cleared)', async t => {
  const user = {
    id: 'u1',
    name: 'John',
    lastName: 'Doe'
  }

  const userService = Fastify()
  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await userService.close()
  })

  userService.register(GQL, {
    schema: buildFederationSchema(`
      extend type Query {
        me: User
      }

      type User @key(fields: "id") {
        id: ID!
        name: String!
      }
    `),
    resolvers: {
      Query: {
        me: () => user
      },
      User: {
        __resolveReference: user => user
      }
    }
  })

  await userService.listen({ port: 0 })

  const userServicePort = userService.server.address().port

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'user',
          url: `http://localhost:${userServicePort}/graphql`
        }
      ],
      pollingInterval: 2000
    }
  })

  await gateway.listen({ port: 0 })

  const res = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({
      query: `
        query MainQuery {
          me {
            id
            name
          }
        }
      `
    })
  })

  t.same(JSON.parse(res.body), {
    data: {
      me: {
        id: 'u1',
        name: 'John'
      }
    }
  })

  userService.graphql.replaceSchema(
    buildFederationSchema(`
      extend type Query {
        me2: User
      }

      type User @key(fields: "id") {
        id: ID!
        name: String!
      }
    `)
  )
  userService.graphql.defineResolvers({
    Query: {
      me2: () => user
    },
    User: {
      __resolveReference: user => user
    }
  })

  for (let i = 0; i < 100; i++) {
    await t.context.clock.tickAsync(100)
  }

  // We need the event loop to actually spin twice to
  // be able to propagate the change
  await immediate()
  await immediate()

  const res2 = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({
      query: `
        query MainQuery {
          me {
            id
            name
          }
        }
      `
    })
  })

  t.same(JSON.parse(res2.body), {
    errors: [
      {
        message: 'Cannot query field "me" on type "Query". Did you mean "me2"?',
        locations: [{ line: 3, column: 11 }]
      }
    ],
    data: null
  })

  const res3 = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({
      query: `
        query MainQuery {
          me2 {
            id
            name
          }
        }
      `
    })
  })

  t.same(JSON.parse(res3.body), {
    data: {
      me2: {
        id: 'u1',
        name: 'John'
      }
    }
  })
})

test('Polling schemas (should properly regenerate the schema when a downstream service restarts)', async t => {
  const oldSchema = `
    type Query {
      me: User
    }

    type User @key(fields: "id") {
      id: ID!
      name: String!
    }
  `
  const user = {
    id: 'u1',
    name: 'John',
    lastName: 'Doe'
  }

  const userService = Fastify()
  const gateway = Fastify()

  userService.register(GQL, {
    schema: buildFederationSchema(oldSchema),
    resolvers: {
      Query: {
        me: () => user
      },
      User: {
        __resolveReference: user => user
      }
    }
  })

  await userService.listen({ port: 0 })

  const userServicePort = userService.server.address().port

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'user',
          url: `http://localhost:${userServicePort}/graphql`
        }
      ],
      pollingInterval: 2000
    }
  })

  const res = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({
      query: `
        query MainQuery {
          me {
            id
            name
          }
        }
      `
    })
  })

  t.same(JSON.parse(res.body), {
    data: {
      me: {
        id: 'u1',
        name: 'John'
      }
    }
  })

  await userService.close()

  const restartedUserService = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await userService.close()
    await restartedUserService.close()
  })

  const refreshedSchema = `
    type User @key(fields: "id") {
      id: ID!
      lastName: String!
      name: String!
    }

    type Mutation {
      create: User!
    }

    type Query {
      me2: User
    }
  `

  restartedUserService.register(GQL, {
    schema: buildFederationSchema(refreshedSchema),
    resolvers: {
      Query: {
        me2: () => user
      },
      Mutation: {
        create: () => user
      },
      User: {
        __resolveReference: user => user
      }
    }
  })

  await restartedUserService.listen({ port: userServicePort })

  for (let i = 0; i < 100; i++) {
    await t.context.clock.tickAsync(100)
  }

  // We need the event loop to actually spin twice to
  // be able to propagate the change
  await immediate()
  await immediate()

  const res2 = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({
      query: `
        query MainQuery {
          me {
            id
            name
          }
        }
      `
    })
  })

  t.same(JSON.parse(res2.body), {
    errors: [
      {
        message: 'Cannot query field "me" on type "Query". Did you mean "me2"?',
        locations: [{ line: 3, column: 11 }]
      }
    ],
    data: null
  })

  const res3 = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({
      query: `
        mutation NewMutation {
          create {
            id
            name
          }
        }
      `
    })
  })

  t.same(JSON.parse(res3.body), {
    data: {
      create: {
        id: 'u1',
        name: 'John'
      }
    }
  })
})

test('Polling schemas (subscriptions should be handled)', async t => {
  t.plan(12)

  const user = {
    id: 'u1',
    name: 'John',
    lastName: 'Doe'
  }

  const resolvers = {
    Query: {
      me: () => user
    },
    Mutation: {
      triggerUser: async (root, args, { pubsub }) => {
        await pubsub.publish({
          topic: 'UPDATED.USER',
          payload: {
            updatedUser: user
          }
        })

        return true
      }
    },
    Subscription: {
      updatedUser: {
        subscribe: async (root, args, { pubsub }) =>
          pubsub.subscribe('UPDATED.USER')
      }
    },
    User: {
      __resolveReference: user => user
    }
  }

  const userService = Fastify()
  const gateway = Fastify()

  t.teardown(async () => {
    await gateway.close()
    await userService.close()
  })

  userService.register(GQL, {
    schema: buildFederationSchema(`
      extend type Query {
        me: User
      }

      extend type Subscription {
        updatedUser: User
      }

      extend type Mutation {
        triggerUser: Boolean
      }

      type User @key(fields: "id") {
        id: ID!
        name: String!
      }
    `),
    resolvers,
    subscription: true
  })

  await userService.listen({ port: 0 })

  const userServicePort = userService.server.address().port

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'user',
          url: `http://localhost:${userServicePort}/graphql`,
          wsUrl: `ws://localhost:${userServicePort}/graphql`
        }
      ],
      pollingInterval: 2000
    },
    subscription: true
  })

  await gateway.listen({ port: 0 })

  const ws = new WebSocket(
    `ws://localhost:${gateway.server.address().port}/graphql`,
    'graphql-ws'
  )

  t.equal(ws.readyState, WebSocket.CONNECTING)

  const client = WebSocket.createWebSocketStream(ws, {
    encoding: 'utf8',
    objectMode: true
  })
  t.teardown(client.destroy.bind(client))
  client.setEncoding('utf8')

  client.write(
    JSON.stringify({
      type: 'connection_init'
    })
  )

  {
    const [chunk] = await once(client, 'data')
    const data = JSON.parse(chunk)
    t.equal(data.type, 'connection_ack')

    client.write(
      JSON.stringify({
        id: 1,
        type: 'start',
        payload: {
          query: `
            subscription {
              updatedUser {
                id
                name
              }
            }
          `
        }
      })
    )

    // We need the event loop to spin twice
    // for the subscription to be created
    await immediate()
    await immediate()

    gateway.inject({
      method: 'POST',
      url: '/graphql',
      body: {
        query: `
          mutation {
            triggerUser
          }
        `
      }
    })
  }

  {
    const [chunk] = await once(client, 'data')
    const data = JSON.parse(chunk)
    client.end()
    t.equal(data.type, 'data')
    t.equal(data.id, 1)

    const { payload: { data: { updatedUser = {} } = {} } = {} } = data

    t.same(updatedUser, {
      id: 'u1',
      name: 'John'
    })
  }

  userService.graphql.replaceSchema(
    buildFederationSchema(`
      extend type Query {
        me: User
      }

      extend type Subscription {
        updatedUser: User
      }

      extend type Mutation {
        triggerUser: Boolean
      }

      type User @key(fields: "id") {
        id: ID!
        name: String!
        lastName: String
      }
    `)
  )

  userService.graphql.defineResolvers(resolvers)

  await t.context.clock.tickAsync(10000)

  // We need the event loop to actually spin twice to
  // be able to propagate the change
  await immediate()
  await immediate()

  t.same(Object.keys(gateway.graphql.schema.getType('User').getFields()), [
    'id',
    'name',
    'lastName'
  ])

  // t.equal(ws.readyState, WebSocket.OPEN)

  const ws2 = new WebSocket(
    `ws://localhost:${gateway.server.address().port}/graphql`,
    'graphql-ws'
  )

  t.equal(ws2.readyState, WebSocket.CONNECTING)

  const client2 = WebSocket.createWebSocketStream(ws2, {
    encoding: 'utf8',
    objectMode: true
  })
  t.teardown(client2.destroy.bind(client2))
  client2.setEncoding('utf8')

  client2.write(
    JSON.stringify({
      type: 'connection_init'
    })
  )

  {
    const [chunk] = await once(client2, 'data')
    const data = JSON.parse(chunk)
    t.equal(data.type, 'connection_ack')

    client2.write(
      JSON.stringify({
        id: 2,
        type: 'start',
        payload: {
          query: `
            subscription {
              updatedUser {
                id
                name
                lastName
              }
            }
          `
        }
      })
    )

    // We need the event loop to spin twice
    // for the subscription to be created
    await immediate()
    await immediate()

    gateway.inject({
      method: 'POST',
      url: '/graphql',
      body: {
        query: `
          mutation {
            triggerUser
          }
        `
      }
    })
  }

  {
    const [chunk] = await once(client2, 'data')
    const data = JSON.parse(chunk)
    t.equal(data.type, 'data')
    t.equal(data.id, 2)

    const { payload: { data: { updatedUser = {} } = {} } = {} } = data

    t.same(updatedUser, {
      id: 'u1',
      name: 'John',
      lastName: 'Doe'
    })
  }

  t.equal(ws2.readyState, WebSocket.OPEN)
  client2.end()

  await gateway.close()
  await userService.close()
})

test('Polling schemas (with dynamic services function, service added)', async (t) => {
  const userService = Fastify()
  const postService = Fastify()
  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await userService.close()
    await postService.close()
  })

  const user = {
    id: 'u1',
    name: 'John'
  }

  userService.register(GQL, {
    schema: buildFederationSchema(`
      extend type Query {
        me: User
      }

      type User @key(fields: "id") {
        id: ID!
        name: String!
      }
    `),
    resolvers: {
      Query: {
        me: () => user
      },
      User: {
        __resolveReference: (user) => user
      }
    }
  })

  await userService.listen({ port: 0 })

  const userServicePort = userService.server.address().port

  const posts = {
    p1: {
      pid: 'p1',
      title: 'Post 1',
      content: 'Content 1',
      authorId: 'u1'
    }
  }

  postService.register(GQL, {
    schema: buildFederationSchema(`
      type Post @key(fields: "pid") {
        pid: ID!
        author: User
      }

      extend type Query {
        topPosts(count: Int): [Post]
      }

      type User @key(fields: "id") @extends {
        id: ID! @external
        topPosts(count: Int!): [Post]
      }`),
    resolvers: {
      Post: {
        __resolveReference: (post, args, context, info) => {
          return posts[post.pid]
        },
        author: (post, args, context, info) => {
          return {
            __typename: 'User',
            id: post.authorId
          }
        }
      },
      User: {
        topPosts: (user, { count }, context, info) => {
          return Object.values(posts)
            .filter((p) => p.authorId === user.id)
            .slice(0, count)
        }
      },
      Query: {
        topPosts: (root, { count = 2 }) => Object.values(posts).slice(0, count)
      }
    }
  })

  await postService.listen({ port: 0 })

  const postServicePort = postService.server.address().port

  const services = [
    {
      name: 'user',
      url: `http://localhost:${userServicePort}/graphql`
    }
  ]

  const servicesFn = async () => services
  await gateway.register(plugin, {
    gateway: {
      services: servicesFn,
      pollingInterval: 2000
    }
  })

  const res = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({
      query: `
        query MainQuery {
          me {
            id
            name
          }
        }
      `
    })
  })

  t.same(JSON.parse(res.body), {
    data: {
      me: {
        id: 'u1',
        name: 'John'
      }
    }
  })

  const res2 = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({
      query: `
        query MainQuery {
          topPosts {
            pid
          }
        }
      `
    })
  })

  t.same(JSON.parse(res2.body), {
    errors: [
      {
        message: 'Cannot query field "topPosts" on type "Query".',
        locations: [{ line: 3, column: 11 }]
      }
    ],
    data: null
  })

  services.push({
    name: 'post',
    url: `http://localhost:${postServicePort}/graphql`
  })

  for (let i = 0; i < 10; i++) {
    await t.context.clock.tickAsync(200)
  }

  let res3

  while (res3?.statusCode !== 200) {
    await immediate()

    res3 = await gateway.inject({
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      url: '/graphql',
      body: JSON.stringify({
        query: `
        query MainQuery {
          topPosts {
            pid
          }
        }
      `
      })
    })
  }

  t.same(JSON.parse(res3.body), {
    data: {
      topPosts: [
        {
          pid: 'p1'
        }
      ]
    }
  })
})

test('Polling schemas (with dynamic services function, service deleted)', async (t) => {
  const userService = Fastify()
  const postService = Fastify()
  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await userService.close()
    await postService.close()
  })

  const user = {
    id: 'u1',
    name: 'John'
  }

  userService.register(GQL, {
    schema: buildFederationSchema(`
      extend type Query {
        me: User
      }

      type User @key(fields: "id") {
        id: ID!
        name: String!
      }
    `),
    resolvers: {
      Query: {
        me: () => user
      },
      User: {
        __resolveReference: (user) => user
      }
    }
  })

  await userService.listen({ port: 0 })

  const userServicePort = userService.server.address().port

  const posts = {
    p1: {
      pid: 'p1',
      title: 'Post 1',
      content: 'Content 1',
      authorId: 'u1'
    }
  }

  postService.register(GQL, {
    schema: buildFederationSchema(`
      type Post @key(fields: "pid") {
        pid: ID!
        author: User
      }

      extend type Query {
        topPosts(count: Int): [Post]
      }

      type User @key(fields: "id") @extends {
        id: ID! @external
        topPosts(count: Int!): [Post]
      }`),
    resolvers: {
      Post: {
        __resolveReference: (post, args, context, info) => {
          return posts[post.pid]
        },
        author: (post, args, context, info) => {
          return {
            __typename: 'User',
            id: post.authorId
          }
        }
      },
      User: {
        topPosts: (user, { count }, context, info) => {
          return Object.values(posts)
            .filter((p) => p.authorId === user.id)
            .slice(0, count)
        }
      },
      Query: {
        topPosts: (root, { count = 2 }) => Object.values(posts).slice(0, count)
      }
    }
  })

  await postService.listen({ port: 0 })

  const postServicePort = postService.server.address().port

  const services = [
    {
      name: 'user',
      url: `http://localhost:${userServicePort}/graphql`
    },
    {
      name: 'post',
      url: `http://localhost:${postServicePort}/graphql`
    }
  ]

  const servicesFn = async () => services
  await gateway.register(plugin, {
    gateway: {
      services: servicesFn,
      pollingInterval: 2000
    }
  })

  const res = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({
      query: `
        query MainQuery {
          topPosts {
            pid
          }
        }
      `
    })
  })

  t.same(JSON.parse(res.body), {
    data: {
      topPosts: [
        {
          pid: 'p1'
        }
      ]
    }
  })

  services.pop()

  for (let i = 0; i < 10; i++) {
    await t.context.clock.tickAsync(200)
  }

  let res2

  while (res2?.statusCode !== 400) {
    await immediate()

    res2 = await gateway.inject({
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      url: '/graphql',
      body: JSON.stringify({
        query: `
        query MainQuery {
          topPosts {
            pid
          }
        }
      `
      })
    })
  }

  t.same(JSON.parse(res2.body), {
    errors: [
      {
        message: 'Cannot query field "topPosts" on type "Query".',
        locations: [{ line: 3, column: 11 }]
      }
    ],
    data: null
  })
})

test('should not throw when an error happens on the closing function', async (t) => {
  const userService = Fastify()
  const postService = Fastify()
  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await userService.close()
    await postService.close()
  })

  const user = {
    id: 'u1',
    name: 'John'
  }

  userService.register(GQL, {
    schema: buildFederationSchema(`
      extend type Query {
        me: User
      }

      type User @key(fields: "id") {
        id: ID!
        name: String!
      }
    `),
    resolvers: {
      Query: {
        me: () => user
      },
      User: {
        __resolveReference: (user) => user
      }
    }
  })

  await userService.listen({ port: 0 })

  const userServicePort = userService.server.address().port

  const posts = {
    p1: {
      pid: 'p1',
      title: 'Post 1',
      content: 'Content 1',
      authorId: 'u1'
    }
  }

  postService.register(GQL, {
    schema: buildFederationSchema(`
      type Post @key(fields: "pid") {
        pid: ID!
        author: User
      }

      extend type Query {
        topPosts(count: Int): [Post]
      }

      type User @key(fields: "id") @extends {
        id: ID! @external
        topPosts(count: Int!): [Post]
      }`),
    resolvers: {
      Post: {
        __resolveReference: (post, args, context, info) => {
          return posts[post.pid]
        },
        author: (post, args, context, info) => {
          return {
            __typename: 'User',
            id: post.authorId
          }
        }
      },
      User: {
        topPosts: (user, { count }, context, info) => {
          return Object.values(posts)
            .filter((p) => p.authorId === user.id)
            .slice(0, count)
        }
      },
      Query: {
        topPosts: (root, { count = 2 }) => Object.values(posts).slice(0, count)
      }
    }
  })

  await postService.listen({ port: 0 })

  const postServicePort = postService.server.address().port

  const services = [
    {
      name: 'user',
      url: `http://localhost:${userServicePort}/graphql`
    },
    {
      name: 'post',
      url: `http://localhost:${postServicePort}/graphql`
    }
  ]

  const servicesFn = async () => services
  await gateway.register(plugin, {
    gateway: {
      services: servicesFn,
      pollingInterval: 2000
    }
  })

  const prevClose = gateway.graphqlGateway.serviceMap.post.close
  gateway.graphqlGateway.serviceMap.post.close = async () => {
    prevClose()
    t.pass()
    return Promise.reject(new Error('kaboom'))
  }
  services.pop()

  for (let i = 0; i < 10; i++) {
    await t.context.clock.tickAsync(200)
  }
})
