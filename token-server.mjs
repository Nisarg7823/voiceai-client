// Mints short-lived LiveKit access tokens and serves the client page.
//
//   npm start            http://localhost:5173
//
// The API secret stays in .env on this process; the browser only ever sees a
// token that expires. Never hardcode a token into the page again.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import {
  AccessToken,
  RoomAgentDispatch,
  RoomConfiguration,
} from "livekit-server-sdk";

const here = fileURLToPath(new URL(".", import.meta.url));

// Local .env wins; the agent's .env one level up is the fallback so a single
// file can configure both processes. dotenv never overwrites what is already set.
loadEnv({ path: join(here, ".env") });
loadEnv({ path: join(here, "..", ".env") });

const {
  LIVEKIT_URL,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
  LIVEKIT_ROOM = "test-room",
  LIVEKIT_AGENT_NAME = "VoiceAIAgentInbound",
  TOKEN_TTL = "15m",
  PORT = "5173",
} = process.env;

const missing = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"].filter(
  (key) => !process.env[key],
);
if (missing.length) {
  console.error(`Missing in .env: ${missing.join(", ")}`);
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function mintToken(identity) {
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    name: identity,
    ttl: TOKEN_TTL,
  });

  at.addGrant({ roomJoin: true, room: LIVEKIT_ROOM, canPublish: true, canSubscribe: true });

  // Tells LiveKit to pull our agent worker into the room on join.
  at.roomConfig = new RoomConfiguration({
    agents: [new RoomAgentDispatch({ agentName: LIVEKIT_AGENT_NAME })],
  });

  return at.toJwt();
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

async function serveStatic(res, urlPath) {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  const file = join(here, rel === "/" || rel === "." ? "index.html" : rel);

  if (!file.startsWith(here)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
      "content-length": body.length,
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}

const server = createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, "http://localhost");

  if (pathname === "/token") {
    // A stable identity per tab keeps reconnects from stacking participants.
    const identity = searchParams.get("identity") || `web-user-${randomUUID().slice(0, 8)}`;
    try {
      sendJson(res, 200, {
        url: LIVEKIT_URL,
        token: await mintToken(identity),
        room: LIVEKIT_ROOM,
        identity,
      });
    } catch (err) {
      console.error("token mint failed:", err);
      sendJson(res, 500, { error: "could not mint token" });
    }
    return;
  }

  await serveStatic(res, pathname);
});

server.listen(Number(PORT), () => {
  console.log(`Client  →  http://localhost:${PORT}`);
  console.log(`Room    →  ${LIVEKIT_ROOM}   Agent → ${LIVEKIT_AGENT_NAME}`);
  console.log(`LiveKit →  ${LIVEKIT_URL}    Token TTL → ${TOKEN_TTL}`);
});
