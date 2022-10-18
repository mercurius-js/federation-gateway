'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const GQL = require('mercurius')
const { createClient } = require('graphql-ws')
const ws = require('ws')
const { promisify } = require('util')
const { createGateway } = require('../index')
const sleep = promisify(setTimeout)

async function createTestService(port, schema, resolvers = {}) {
  const service = Fastify()

  service.register(GQL, {
    schema,
    resolvers,
    federationMetadata: true,
    ide: true,
    routes: true,
    subscription: true
  })
  await service.listen(port)
  return service
}

const schemaBody = `
  type User {
    name: String
  }
  extend type Query {
    result(num: Int): Int
  }

  extend type Mutation {
    updateUser(name: String): User
  }
  `
const resolvers = {
  Query: {
    result: async (_, { num }) => {
      return num
    }
  },
  Mutation: {
    updateUser: (_, { name }) => {
      return {
        name
      }
    }
  }
}

test('gateway - send query using graphql-ws protocol', async t => {
  t.plan(1)

  const service1 = await createTestService(0, schemaBody, resolvers)
  const app = Fastify()

  t.teardown(async () => {
    await app.close()
    await service1.close()
  })

  const gateway = await createGateway(
    {
      services: [
        {
          name: 'test',
          url: `http://localhost:${service1.server.address().port}/graphql`,
          wsUrl: `ws://localhost:${service1.server.address().port}/graphql`,
          wsConnectionParams: {
            protocols: ['graphql-ws']
          },
          keepAlive: 3000
        }
      ]
    },
    app
  )

  await app.register(GQL, {
    routes: true,
    subscription: {
      fullWsTransport: true
    },
    jit: 1,
    schema: gateway.schema
  })

  await app.listen({ port: 0 })

  const client = createClient({
    url: `ws://localhost:${app.server.address().port}/graphql`,
    webSocketImpl: ws
  })

  client.subscribe(
    {
      query: '{ result(num: 5) }'
    },
    {
      next: data => {
        t.strictSame(data, { data: { result: 5 } })
      },
      complete: () => {
        client.dispose()
        t.end()
      }
    }
  )

  await sleep(500)
})

test('gateway - send mutations using graphql-ws protocol', async t => {
  t.plan(1)
  const service1 = await createTestService(0, schemaBody, resolvers)

  const app = Fastify()
  t.teardown(async () => {
    await app.close()
    await service1.close()
  })

  const { schema } = await createGateway(
    {
      services: [
        {
          name: 'test',
          url: `http://localhost:${service1.server.address().port}/graphql`,
          wsUrl: `ws://localhost:${service1.server.address().port}/graphql`,
          wsConnectionParams: {
            protocols: ['graphql-ws']
          },
          keepAlive: 3000
        }
      ]
    },
    app
  )

  await app.register(GQL, {
    routes: true,
    subscription: {
      fullWsTransport: true
    },
    jit: 1,
    schema
  })

  await app.listen({ port: 0 })

  const client = createClient({
    url: `ws://localhost:${app.server.address().port}/graphql`,
    webSocketImpl: ws
  })

  client.subscribe(
    {
      query: `
        mutation {
          updateUser(name: "Random user") {
            name
          }
        }
      `
    },
    {
      next: data => {
        t.strictSame(data, { data: { updateUser: { name: 'Random user' } } })
      },
      complete: () => {
        client.dispose()
        t.end()
      }
    }
  )

  await sleep(500)
})
