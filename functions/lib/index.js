"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const Koa = require("koa");
const Router = require("koa-router");
const Functions = require("firebase-functions");
const routes_1 = require("./routes");
const app = new Koa();
const root = new Router();
root.use("/api", routes_1.default.routes(), routes_1.default.allowedMethods());
root.get("/.well-known/webfinger", (ctx) => __awaiter(this, void 0, void 0, function* () {
    ctx.set('Content-Type', 'application/activity+json');
    const [uname] = ctx.query.resource.split('acct:')[1].split('@');
    ctx.body = {
        "subject": `${ctx.query.resource}`,
        "links": [
            {
                "rel": "self",
                "type": "application/activity+json",
                "href": `https://${ctx.host}/@${uname}`
            }
        ]
    };
}));
app.use(root.routes());
exports.default = Functions.https.onRequest(app.callback());
//# sourceMappingURL=index.js.map