import * as Koa from 'koa'

import * as Router from 'koa-router'

import * as Functions from 'firebase-functions'

import routes from './routes'

const app = new Koa()

const root = new Router()
root.use("/api", routes.routes(), routes.allowedMethods())

app.use(root.routes())

export default Functions.https.onRequest(app.callback())
