import * as Router from 'koa-router'

const router = new Router()

router.all("/(.*)", async (ctx) => {
    ctx.body = {
        path: ctx.path,
        params: ctx.params
    }
})

export default router
