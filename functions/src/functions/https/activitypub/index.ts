import * as Router from 'koa-router'
import * as BodyParser from 'koa-bodyparser'
import * as Joi from 'joi'

import * as DraftCavegeHTTPSignatures10 from '@ouka/draft-cavage-http-signature-10'

import config from '~/config'
import Actor from '~/models/actor'
import { firestore } from '~/preload';

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
const DraftCavegeHTTPSignatures10Middleware = async (ctx, next) => {
  const r = Joi.object().required().keys({
    signature: Joi.string().required()
  }).unknown(true).validate<{
    signature: string
  }>(ctx.headers)
  if (r.error) throw r.error

  const signature = DraftCavegeHTTPSignatures10.decode(r.value.signature)
  try {
    const actor = await Actor.fetch(signature.keyId)
    await DraftCavegeHTTPSignatures10.verify({ signature, headers: ctx.headers, method: ctx.method, path: ctx.path, actor })
    ctx.state.actor = actor
    return next()
  } catch (e) {
    if (e instanceof DraftCavegeHTTPSignatures10.InvalidSignatureError) return ctx.throw(400, 'Invalid signature given.')
    throw e
  }
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
        "@context": "https://www.w3.org/ns/activitystreams",
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
