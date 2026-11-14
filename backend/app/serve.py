import os

import uvicorn


if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.environ.get("PORT", "10000")),
                workers=1, access_log=False, ws="websockets", ws_max_size=32768,
                timeout_graceful_shutdown=20)
