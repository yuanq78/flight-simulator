#!/bin/sh
# 启动 AeroSim X 静态服务器（带 /diag 诊断日志与禁缓存头）
cd "$(dirname "$0")"
export PORT=${PORT:-8000}
echo "AeroSim X → http://localhost:$PORT"
exec python3 serve.py
