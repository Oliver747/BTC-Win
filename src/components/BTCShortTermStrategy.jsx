import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Scatter } from "recharts";
import { BadgeCheck, Clock, TrendingUp, TrendingDown } from "lucide-react";

const EMA = (data, period, key = 'close') => {
  const k = 2 / (period + 1);
  let ema = [];
  data.forEach((d, i) => {
    if (i === 0) {
      ema.push(d[key]);
    } else {
      ema.push(d[key] * k + ema[i - 1] * (1 - k));
    }
  });
  return ema;
};

const MACD = (data, shortPeriod = 12, longPeriod = 26, signalPeriod = 9) => {
  const shortEMA = EMA(data, shortPeriod);
  const longEMA = EMA(data, longPeriod);
  const dif = shortEMA.map((val, i) => val - longEMA[i]);
  const dea = EMA(dif.map(v => ({ close: v })), signalPeriod);
  const macd = dif.map((val, i) => val - dea[i]);
  return { dif, dea, macd };
};

const RSI = (data, period = 14) => {
  let rsis = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period) {
      rsis.push(null);
    } else {
      let gains = 0, losses = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const change = data[j].close - data[j - 1].close;
        if (change > 0) gains += change;
        else losses -= change;
      }
      const rs = gains / (losses || 1);
      rsis.push(100 - 100 / (1 + rs));
    }
  }
  return rsis;
};

const useBinanceKlines = (interval = '5m', limit = 30) => {
  const [klines, setKlines] = useState([]);
  const socketRef = useRef(null);

  useEffect(() => {
    const fetchInitialData = async () => {
      const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`);
      const raw = await res.json();
      const formatted = raw.map(d => ({
        time: new Date(d[0]).toLocaleTimeString(),
        timestamp: d[0],
        open: parseFloat(d[1]),
        high: parseFloat(d[2]),
        low: parseFloat(d[3]),
        close: parseFloat(d[4]),
        volume: parseFloat(d[5])
      }));
      setKlines(formatted);
    };

    fetchInitialData();

    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/btcusdt@kline_${interval}`);
    socketRef.current = ws;
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.k && msg.k.x) {
        setKlines(prev => {
          const newData = [...prev.slice(-limit + 1), {
            time: new Date(msg.k.t).toLocaleTimeString(),
            timestamp: msg.k.t,
            open: parseFloat(msg.k.o),
            high: parseFloat(msg.k.h),
            low: parseFloat(msg.k.l),
            close: parseFloat(msg.k.c),
            volume: parseFloat(msg.k.v)
          }];
          return newData;
        });
      }
    };

    return () => ws.close();
  }, [interval, limit]);

  return klines;
};

export default function BTCShortTermStrategy() {
  const klines = useBinanceKlines('5m', 30);
  const displayData = useBinanceKlines('1m', 200);
  const [trend, setTrend] = useState("等待判断");
  const [signal, setSignal] = useState("无信号");
  const [entries, setEntries] = useState([]);
  const [autoMode, setAutoMode] = useState(true);

  // 用于自动滚动到底部的 ref
  const recordsEndRef = useRef(null);

  const evaluateSignal = () => {
    if (klines.length < 26) return;

    const close = klines.map(k => k.close);
    const ema10 = EMA(klines, 10);
    const ema20 = EMA(klines, 20);
    const rsi = RSI(klines);
    const { dif, dea, macd } = MACD(klines);

    const idx = klines.length - 1;
    const latest = klines[idx];

    let up = 0, down = 0;

    if (latest.close > ema10[idx] && latest.close > latest.open) up++;
    if (latest.close < ema10[idx] && latest.close < latest.open) down++;
    if (ema10[idx] > ema20[idx]) up++;
    if (ema10[idx] < ema20[idx]) down++;
    if (dif[idx] > dea[idx] && macd[idx] > 0) up++;
    if (dif[idx] < dea[idx] && macd[idx] < 0) down++;
    if (rsi[idx] > 60) up++;
    if (rsi[idx] < 40) down++;

    let nextTrend = "横盘观望";
    if (up >= 3) nextTrend = "上涨";
    else if (down >= 3) nextTrend = "下跌";

    setTrend(nextTrend);

    let nextSignal = "无信号";
    if (nextTrend === "上涨" && latest.low <= ema10[idx] && latest.close > latest.open) {
      nextSignal = "做多进场信号 ✅";
    } else if (nextTrend === "下跌" && latest.high >= ema10[idx] && latest.close < latest.open) {
      nextSignal = "做空进场信号 ✅";
    }
    setSignal(nextSignal);

    if (nextSignal.includes("✅")) {
      const lastEntry = entries[entries.length - 1];
      const latestTime = latest.timestamp;
      const lastTime = lastEntry?.timestamp || 0;
      const fiveMinutes = 5 * 60 * 1000;

      if (latestTime - lastTime >= fiveMinutes) {
        const entry = {
          timestamp: latestTime,
          price: latest.close,
          type: nextSignal.includes("做多") ? "long" : "short",
          result: "等待判断"
        };
        setEntries(prev => [...prev, entry]);
      }
    }
  };

  // 自动周期评估信号
  useEffect(() => {
    if (autoMode) {
      const interval = setInterval(() => {
        evaluateSignal();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [klines, autoMode, entries]);

  // 胜负判定，10分钟后对比价格判断胜负
  useEffect(() => {
    const now = Date.now();
    const updated = entries.map(entry => {
      if (entry.result !== "等待判断") return entry;
      const targetTime = entry.timestamp + 10 * 60 * 1000;
      if (now >= targetTime) {
        const after = displayData.find(k => k.timestamp >= targetTime);
        if (after) {
          const profit = entry.type === "long" ? after.close - entry.price : entry.price - after.close;
          return { ...entry, result: profit > 0 ? "胜" : "负" };
        }
      }
      return entry;
    });
    setEntries(updated);
  }, [displayData]);

  // 自动滚动到底部，最新记录可见
  useEffect(() => {
    if (recordsEndRef.current) {
      recordsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [entries]);

  // 手动下单，参数 "long" 或 "short"
  const manualOrder = (type) => {
    if (klines.length === 0) return;
    const latest = klines[klines.length - 1];
    const latestTime = latest.timestamp;
    const lastEntry = entries[entries.length - 1];
    const lastTime = lastEntry?.timestamp || 0;
    const fiveMinutes = 5 * 60 * 1000;

    if (latestTime - lastTime < fiveMinutes) {
      alert("距离上次下单不足5分钟，请稍候");
      return;
    }

    const entry = {
      timestamp: latestTime,
      price: latest.close,
      type,
      result: "等待判断",
    };
    setEntries(prev => [...prev, entry]);
  };

  // 构造图表数据，计算1分钟K线的ema10和ema20
  const chartData = displayData.map((k, i) => ({
    time: k.time,
    timestamp: k.timestamp,
    price: k.close,
    ema10: EMA(displayData.slice(0, i + 1), 10)[i],
    ema20: EMA(displayData.slice(0, i + 1), 20)[i],
  })).filter((_, i) => i >= 10);

  // 进场标记点
  const markers = entries.map(e => ({
    time: new Date(e.timestamp).toLocaleTimeString(),
    price: e.price,
    result: e.result
  }));

  // 最近24小时统计胜率
  const last24Hours = Date.now() - 24 * 60 * 60 * 1000;
  const trades24h = entries.filter(e => e.timestamp >= last24Hours);
  const wins = trades24h.filter(e => e.result === '胜').length;
  const total = trades24h.length;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : "0.0";

  return (
    <div className="p-4 grid gap-4 grid-cols-1 md:grid-cols-2">
      {/* 趋势判断卡片 */}
      <Card className="col-span-1">
        <CardContent className="p-4 space-y-4">
          <h2 className="text-xl font-bold">🔍 趋势判断（5分钟K线）</h2>
          <div className="text-lg flex items-center gap-2">
            {trend === "上涨" && <TrendingUp className="text-green-500" />} 
            {trend === "下跌" && <TrendingDown className="text-red-500" />} 
            {trend === "横盘观望" && <Clock className="text-yellow-500" />} 
            当前趋势：<span className="font-semibold">{trend}</span>
          </div>

          <h2 className="text-xl font-bold">📈 进场信号</h2>
          <div className="text-lg flex items-center gap-2">
            {signal.includes("✅") ? <BadgeCheck className="text-blue-500" /> : <Clock />} 
            当前信号：<span className="font-semibold">{signal}</span>
          </div>

          <div className="flex items-center gap-2">
            自动判断：<Switch checked={autoMode} onCheckedChange={setAutoMode} />
          </div>

          <div className="flex gap-2">
            <Button onClick={evaluateSignal}>手动更新判断</Button>
          </div>

          {/* 新增手动做多 / 做空按钮 */}
          <div className="pt-4 flex gap-4">
            <Button variant="outline" onClick={() => manualOrder("long")}>手动做多</Button>
            <Button variant="outline" onClick={() => manualOrder("short")}>手动做空</Button>
          </div>
        </CardContent>
      </Card>

      {/* 实时图表卡片 */}
      <Card className="col-span-1">
        <CardContent className="p-4">
          <h2 className="text-xl font-bold mb-2">📊 实时图表（1分钟K线）</h2>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData}>
              <XAxis dataKey="time" hide />
              <YAxis domain={['dataMin', 'dataMax']} hide />
              <Tooltip />
              <Line type="monotone" dataKey="price" stroke="#8884d8" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="ema10" stroke="#82ca9d" strokeDasharray="3 3" dot={false} />
              <Line type="monotone" dataKey="ema20" stroke="#ffc658" strokeDasharray="5 5" dot={false} />
              <Scatter data={markers} fill="#ffa500" shape="circle" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* 模拟下单记录卡片，滚动显示全部 */}
      <Card className="col-span-1 md:col-span-2">
        <CardContent className="p-4">
          <h2 className="text-xl font-bold mb-2">📘 模拟下单记录（全部记录）</h2>
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            <ul className="space-y-1 text-sm">
              {entries.length === 0 && <li>暂无记录</li>}
              {entries.slice().reverse().map((item, index) => (
                <li key={index} className="flex justify-between border-b py-1">
                  <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
                  <span>{item.type} @ {item.price} → {item.result}</span>
                </li>
              ))}
            </ul>
            <div ref={recordsEndRef} />
          </div>
          <div className="pt-4 text-sm text-muted-foreground">
            📊 最近24小时共下单：{total} 次，胜率：{winRate}%
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
