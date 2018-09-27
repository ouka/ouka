import * as Router from 'koa-router'
import * as BodyParser from 'koa-bodyparser'
import * as Joi from 'joi'

import config from '../../config'
import Actor from '../../models/actor'
import { firestore } from '../../preload';

import { Request } from 'firebase-functions'

const ap = new Router()

// Only accept type 'application/activity+json', and return type
ap.use((ctx, next) => {
  if (!(ctx.accepts('application/activity+json')) || ctx.method !== 'get' && ctx.request.type === 'applicaiton/activity+json') ctx.throw(400, 'invalid type requested')
  ctx.set('Content-Type', 'application/activity+json')
  ctx.set('Cache-Control', 'private')
  return next()
})

// draft-cavage-http-signatures-10
const DRAFT_CAVEGE_HTTP_SIGNATURES_10_REQUEST_TARGET = `(request-target)`
const DraftCavegeHTTPSignatures10Middleware = async (ctx, next) => {
  return next()
  /**
  const r = Joi.object().required().keys({
    signature: Joi.string().required()
  }).unknown(true).validate<{
    signature: string
  }>(ctx.headers)
  if (r.error) throw r.error

  const rawSignature = (() => {
    const v = r.value.signature.split(`",`).map(vv => vv.split(`="`))
    v[v.length-1][1] = v[v.length-1][1].split(`"`)[0] 
    return v.map((current): [string, string | string[]] => {
      const [key, rawValue] = current
      const value = key === 'headers' ? rawValue.split(' ') : rawValue
      return [key, value]
    }).reduce((target, current) => {
      target[current[0]] = current[1]
      return target
    }, {})
  })()

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
  await actor.save() // cache
  ctx.state.actor = actor

  const sourceHeaders = signature.headers || ['Date']
  const source = sourceHeaders.map(k => {
    if (k === DRAFT_CAVEGE_HTTP_SIGNATURES_10_REQUEST_TARGET) return `${k}: ${ctx.method.toLowerCase()} ${ctx.path}`
    return `${k}: ${ctx.headers[k]}`
  }).join('\n')

  if (!actor.verify(source, signature.signature)) ctx.throw(400, 'Invalid signature, ' + ctx.headers.signature)

  return next()
  */
}

ap.post("/accounts/@:userpart/inbox", DraftCavegeHTTPSignatures10Middleware, async (ctx, next) => {
  ctx.request.body = JSON.parse((ctx.req as any).rawBody)
  return next()
}, async (ctx) => {
  console.dir(ctx.request.body)

    const actor = await Actor.findByUserpart(ctx.params.userpart)

    const body = ctx.request.body as any
    const b = firestore.batch()

    if (body.type === 'Follow') {
      b.set(firestore.collection('accounts').doc(actor.id).collection('outbox').doc(), {
        id: `https://${config.service.host}/ap/accounts/@${ctx.params.userpart}#accepts/followers/#${Math.floor(Math.random()*100)}`,
        type: 'Accept',
        actor: `https://${config.service.host}/ap/accounts/@${ctx.params.userpart}`,
        object: {
          id: body.id,
          type: body.type,
          actor: body.actor,
          object: body.object
        }
      })
    }
    b.set(firestore.collection('accounts').doc(actor.id).collection('inbox').doc(), body)
    await b.commit()

  ctx.status = 201
})

ap.get('/accounts/@:userpart', async (ctx) => {
  ctx.body = (await Actor.findByUserpart(ctx.params.userpart)).toJSON()
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
        "href": `https://${config.service.host}/ap/accounts/@${uname}` 
      }
    ]
  }
})

export default root
