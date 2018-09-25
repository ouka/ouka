import * as Functions from 'firebase-functions'
import * as Koa from 'koa'
import * as Router from 'koa-router'

import config from '../config'

const app = new Koa()

const api = new Router()
api.all("/(.*)", async (ctx) => {
    ctx.body = {
        path: ctx.path,
        params: ctx.params
    }
})

const root = new Router()
root.use("/api", api.routes(), api.allowedMethods())
// fake webfinger
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
        "href": `https://${config.service.host}/@${uname}` 
      }
    ]
  }
})

app.use(root.routes())

export default Functions.https.onRequest(app.callback())
