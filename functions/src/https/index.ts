import * as Functions from 'firebase-functions'
import * as Koa from 'koa'
import * as Router from 'koa-router'

import activityPubRouter from './activitypub'

import reportError from '../logging'

const app = new Koa()

app.use(async (_, next) => {
  try {
    await next()
  } catch (e) {
    await reportError(e)
    throw e
  }
})

const root = new Router()
root.use("/", activityPubRouter.routes(), activityPubRouter.allowedMethods())

app.use(root.routes())

export default Functions.https.onRequest(app.callback())
