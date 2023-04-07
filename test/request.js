const { test } = require('tap')
const fastify = require('fastify')
const { sendRequest, buildRequest } = require('../lib/gateway/request')
const { FederatedError } = require('../lib/errors')

test('sendRequest method rejects when request errs', t => {
  const url = new URL('http://localhost:3001')
  const { request } = buildRequest({ url })
  t.rejects(
    sendRequest(
      request,
      url
    )({
      method: 'POST',
      body: JSON.stringify({
        query: `
      query ServiceInfo {
        _service {
          sdl
        }
      }
      `
      })
    })
  )
  t.end()
})

test('sendRequest method rejects when response is not valid json', async t => {
  t.plan(3)
  const app = fastify()
  app.post('/', async () => {
    return 'response'
  })

  await app.listen({ port: 0 })

  const url = new URL(`http://localhost:${app.server.address().port}`)
  const { request, close } = buildRequest({ url })
  t.teardown(() => {
    close()
    return app.close()
  })
  try {
    await sendRequest(
      request,
      url
    )({
      method: 'POST',
      body: JSON.stringify({
        query: `
        query ServiceInfo {
          _service {
            sdl
          }
        }
        `
      })
    })
    t.fail('it must throw')
  } catch (error) {
    t.type(error, FederatedError)
    t.type(error.extensions.errors, 'Array')

    // Full string on Node 17 is "Unexpected token r in JSON at position 0"
    t.match(error.extensions.errors[0].message, 'Unexpected token')
  }
})

test('sendRequest method rejects when response contains only errors', async t => {
  t.plan(2)
  const app = fastify()
  app.post('/', async () => {
    return { errors: ['foo'] }
  })

  await app.listen({ port: 0 })

  const url = new URL(`http://localhost:${app.server.address().port}`)
  const { request, close } = buildRequest({ url })
  t.teardown(() => {
    close()
    return app.close()
  })

  try {
    await sendRequest(
      request,
      url
    )({
      method: 'POST',
      body: JSON.stringify({
        query: `
      query ServiceInfo {
        _service {
          sdl
        }
      }
      `
      })
    })
    t.fail('it must throw')
  } catch (error) {
    t.type(error, FederatedError)
    t.same(error.extensions, { errors: ['foo'] })
  }
})

test('sendRequest method accepts when response contains data and errors', async t => {
  t.plan(2)
  const app = fastify()
  app.post('/', async () => {
    return { data: {}, errors: ['foo'] }
  })

  await app.listen({ port: 0 })

  const url = new URL(`http://localhost:${app.server.address().port}`)
  const { request, close } = buildRequest({ url })
  t.teardown(() => {
    close()
    return app.close()
  })
  const context = {}
  const result = await sendRequest(
    request,
    url
  )({
    context,
    method: 'POST',
    body: JSON.stringify({
      query: `
      query ServiceInfo {
        _service {
          sdl
        }
      }
      `
    })
  })
  t.same(result.json, { data: {}, errors: ['foo'] })
  t.same(context, { errors: ['foo'] })
})

test('sendRequest method should accept useSecureParse flag and parse the response securely', async t => {
  const app = fastify()
  app.post('/', async () => {
    return '{" __proto__": { "foo": "bar" } }'
  })

  await app.listen({ port: 0 })

  const url = new URL(`http://localhost:${app.server.address().port}`)
  const { request, close } = buildRequest({ url })
  t.teardown(() => {
    close()
    return app.close()
  })
  const result = await sendRequest(
    request,
    url,
    true
  )({
    method: 'POST',
    body: JSON.stringify({
      query: `
    query ServiceInfo {
      _service {
        sdl
      }
    }
    `
    })
  })

  // checking for prototype leakage: https://github.com/fastify/secure-json-parse#introduction
  // secure parsing should not allow it
  t.ok(result.json)
  t.notOk(result.json.foo)
  const testObject = Object.assign({}, result.json)
  t.notOk(testObject.foo)

  t.end()
})

test('sendRequest method should run without useSecureParse flag', async t => {
  const app = fastify()
  app.post('/', async () => {
    return '{ "foo": "bar" }'
  })

  await app.listen({ port: 0 })

  const url = new URL(`http://localhost:${app.server.address().port}`)
  const { request, close } = buildRequest({ url })
  t.teardown(() => {
    close()
    return app.close()
  })
  const result = await sendRequest(
    request,
    url,
    false
  )({
    method: 'POST',
    body: JSON.stringify({
      query: `
      query ServiceInfo {
        _service {
          sdl
        }
      }
      `
    })
  })

  t.same(result.json, { foo: 'bar' })

  t.end()
})
