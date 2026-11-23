import { Miniflare } from "miniflare"; import assert from "node:assert/strict";
const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('')}}", d1Databases: ["DB"] });
const db = await mf.getD1Database("DB");
await db.exec("CREATE TABLE onda_requests (id TEXT, source TEXT); CREATE TABLE onda_matches (id TEXT, request_id TEXT, responder_id TEXT, status TEXT, created_at TEXT DEFAULT (datetime('now')));");
await db.exec("INSERT INTO onda_requests VALUES ('rN','manual'),('rE','evac_forecast');");
const ins = (id, req, ago) => db.prepare(`INSERT INTO onda_matches (id,request_id,responder_id,status,created_at) VALUES (?,?,'h','offered',datetime('now', ?))`).bind(id, req, `-${ago} seconds`).run();
await ins("n30","rN",30); await ins("n90","rN",90); await ins("e90","rE",90); await ins("e240","rE",240); await ins("e360","rE",360);
const q = `SELECT m.id FROM onda_matches m LEFT JOIN onda_requests r ON r.id = m.request_id WHERE m.status = 'offered'
  AND datetime(m.created_at) < CASE WHEN r.source = 'evac_forecast' THEN datetime('now', '-5 minutes') ELSE datetime('now', '-60 seconds') END`;
const got = (await db.prepare(q).all()).results.map(r => r.id).sort();
console.log("만료 대상:", got); assert.deepEqual(got, ["e360", "n90"]);
// 옛 방식(ISO 비교)은 30초짜리도 만료시켰는지 확인
const old = (await db.prepare("SELECT id FROM onda_matches WHERE created_at < ?").bind(new Date(Date.now()-60000).toISOString()).all()).results.map(r=>r.id).sort();
console.log("옛 방식이었다면:", old);
await mf.dispose();
