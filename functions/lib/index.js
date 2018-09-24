"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Koa = require("koa");
const Router = require("koa-router");
const Functions = require("firebase-functions");
const routes_1 = require("./routes");
const app = new Koa();
const root = new Router();
root.use("/api", routes_1.default.routes(), routes_1.default.allowedMethods());
app.use(root.routes());
exports.default = Functions.https.onRequest(app.callback());
//# sourceMappingURL=index.js.map