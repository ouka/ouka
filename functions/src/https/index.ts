import * as Functions from 'firebase-functions'
import * as Koa from 'koa'

import activityPubRouter from './activitypub'

import reportError from '../logging'

const app = new Koa()

app.use(async ({ body, headers }, next) => {
  try {
    await next()
  } catch (e) {
    await reportError(e, {
      body,
      headers
    })
    throw e
  }
})

app.use(activityPubRouter.routes())

export default Functions.https.onRequest(app.callback())
