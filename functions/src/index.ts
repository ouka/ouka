import * as Koa from 'koa'

import * as Router from 'koa-router'

import * as Functions from 'firebase-functions'

import routes from './routes'

const app = new Koa()

const root = new Router()
root.use("/api", routes.routes(), routes.allowedMethods())

// fake webfinger
root.get("/.well-known/webfinger", async ctx => {
  ctx.set('Content-Type', 'application/activity+json')
  const [uname] = ctx.query.resource.split('acct:')[1].split('@')

  ctx.body = {
    "subject": `${ctx.query.resource}`,

    "links": [
      {
        "rel": "self",
        "type": "application/activity+json",
        "href": `https://${ctx.host}/@${uname}` 
      }
    ]
  }
})

app.use(root.routes())

export default Functions.https.onRequest(app.callback())
