import * as Router from 'koa-router'
import * as BodyParser from 'koa-bodyparser'
import * as Joi from 'joi'

import config from '../../config'
import Actor from '../../models/actor'

const ap = new Router()

// Only accept 'Accept: application/activity+json', and return type
ap.use((ctx, next) => {
  if (!(ctx.headers.Accept && ctx.headers.Accept === 'application/activity+json')) ctx.throw(400, 'invalid: accept header')
  ctx.set('Content-Type', 'application/activity+json')
  return next()
})

// draft-cavage-http-signatures-10
const DRAFT_CAVEGE_HTTP_SIGNATURES_10_REQUEST_TARGET = `(request-target)`
const DraftCavegeHTTPSignatures10Middleware = async (ctx, next) => {
  const r = Joi.object().required().keys({
    signature: Joi.string().required()
  }).validate<{
    signature: string
  }>(ctx.headers)
  if (r.error) throw r.error

  const rawSignature = r.value.signature.split(',').map(v => {
    return v.split('=')
  }).map(current => {
    const [key, rawValue] = current
    const value = key === 'headers' ? JSON.parse(rawValue) : JSON.parse(rawValue).split(' ')
    return [key, value]
  }).reduce((target, current) => {
    target[current[0]] = current[1]
    return target
  }, {})

  const { error, value: signature } = Joi.object().required().keys({
    keyId: Joi.string().required(),
    signature: Joi.string().required(),
    headers: Joi.array().items(Joi.string()),
    algorithm: Joi.string()
  }).validate<{
    keyId: string,
    signature: string,
    headers?: string[],
    algorithm?: string
  }>(rawSignature as any)
  if (error) throw error

  // get actor
  const actor = await Actor.fetch(signature.keyId)
  ctx.state.actor = actor

  const sourceHeaders = signature.headers || ['Date']
  const source = sourceHeaders.map(k => {
    if (k === DRAFT_CAVEGE_HTTP_SIGNATURES_10_REQUEST_TARGET) return `${k}: ${ctx.method} ${ctx.path}`
    return `${k}: ${ctx.headers[k]}`
  }).join('\n')

  if (!actor.verify(source, signature.signature)) ctx.throw(400, 'Invalid signature')

  return next()
}

ap.post("/accounts/@:userpart/inbox", DraftCavegeHTTPSignatures10Middleware, BodyParser({
  enableTypes: ['json'],
  detectJSON: (ctx) => ctx.headers.accept === 'application/activity+json'
}), async (ctx) => {
  console.dir(ctx.body)
  ctx.status = 500
})

ap.get('/accounts/@:userpart', async (ctx) => {
  return (await Actor.findByUserpart(ctx.params.userpart)).toJSON()
})

const root = new Router()
root.use('/ap', ap.routes(), ap.allowedMethods())

root.get("/.well-known/webfinger", async ctx => {
  ctx.set('Content-Type', 'application/jrd+json')
  const [uname, host] = ctx.query.resource.split('acct:')[1].split('@')

  if (host !== config.service.host) {
    ctx.status = 400
    return
  }

  ctx.body = {
    "subject": `${ctx.query.resource}`,

    "links": [
      {
        "rel": "self",
        "type": "application/activity+json",
        "href": `https://${config.service.host}/accounts/@${uname}` 
      }
    ]
  }
})

export default root
