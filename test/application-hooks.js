'use strict'

const { test, t } = require('tap')
const FakeTimers = require('@sinonjs/fake-timers')
const { GraphQLSchema } = require('graphql')
const { promisify } = require('util')
const Fastify = require('fastify')
const GQL = require('mercurius')
const { buildFederationSchema } = require('@mercuriusjs/federation')

const plugin = require('../index')

const immediate = promisify(setImmediate)

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

// ----------------------
// onGatewayReplaceSchema
// ----------------------
test('onGatewayReplaceSchema - polling interval with a new schema should trigger onGatewayReplaceSchema hook', async t => {
  t.plan(2)

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

  gateway.graphqlGateway.addHook(
    'onGatewayReplaceSchema',
    async (instance, schema) => {
      t.type(instance, 'object')
      t.type(schema, GraphQLSchema)
    }
  )

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
})

test('onGatewayReplaceSchema - should log an error should any errors occur in the hook', async t => {
  t.plan(2)

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

  gateway.graphqlGateway.addHook('onGatewayReplaceSchema', async () => {
    t.ok('trigger error')
    throw new Error('kaboom')
  })

  gateway.graphqlGateway.addHook('onGatewayReplaceSchema', async () => {
    t.fail('should not be called')
  })

  // Override gateway error logger
  gateway.log.error = error => {
    t.same(error, new Error('kaboom'))
  }

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
})
