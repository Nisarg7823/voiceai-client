import { Room } from "livekit-client";

/** Credentials come from the token server, so nothing secret lives in this file. */
async function fetchCredentials() {
  const res = await fetch("/token", { cache: "no-store" });
  if (!res.ok) throw new Error(`token endpoint returned ${res.status}`);
  const { url, token } = await res.json();
  if (!url || !token) throw new Error("token endpoint returned no credentials");
  return { url, token };
}

async function start() {
  const { url, token } = await fetchCredentials();
  const room = new Room();

  room.on("trackSubscribed", (track) => {
    if (track.kind === "audio") {
      const audio = new Audio();
      audio.srcObject = new MediaStream([track.mediaStreamTrack]);
      audio.play();
      console.log("🔊 Playing agent audio");
    }
  });

  await room.connect(url, token);
  console.log("✅ Connected to room:", room.name);
}

start();
