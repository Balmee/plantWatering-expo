import { Picker } from "@react-native-picker/picker";
import axios from "axios";
import mqtt from "mqtt/dist/mqtt";
import React, { useCallback, useEffect, useState } from "react";
import { Dimensions, SafeAreaView, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { LineChart } from "react-native-chart-kit";

/************************************************
 * Dashboard Screen (Expo Router) – watering/data
 * ----------------------------------------------
 * • Live sensor stream via MQTT (watering/data)
 * • Historical moisture graph via ThingSpeak
 * • Manual pump control with duration picker
 *
 * 🚀  Add this file to `app/(tabs)/dashboard.tsx` (or any route)
 *
 * 📦  Dependencies (install once):
 *     expo install mqtt axios react-native-chart-kit @react-native-picker/picker
 *
 * ❗  ThingSpeak needs your CHANNEL_ID for reads – fill it below.
 ************************************************/

/* ==================  CONFIG  ================== */
// ThingSpeak channel ID must be NUMERIC (not the API key!)
const TS_CHANNEL = 2989896;           // 🔴  replace with your numeric channel id, e.g. 225999
const TS_READ_KEY = "";             // leave "" if channel is public

// MQTT — HiveMQ Cloud over WebSocket
const MQTT_URL  = "wss://a1eef8be216949238865abfec7ed13a2.s1.eu.hivemq.cloud/mqtt";
const MQTT_USER = "Balmee";
const MQTT_PASS = "WateringP1ant";
const TOPIC_DATA = "watering/data";
const TOPIC_MAN  = "watering/manual";
/* =============================================================== */

export default function Dashboard() {
  /* ---------- state ---------- */
  const [live, setLive]   = useState({ moisture: "-", temperature: "-", humidity: "-", pump: "-" });
  const [hist, setHist]   = useState<{ labels: string[]; moisture: number[] }>({ labels: [], moisture: [] });
  const [duration, setDuration] = useState<string>("20");
  const [mqttOK, setMqttOK] = useState(false);
  const chartWidth = Dimensions.get("window").width - 40;

  /* ---------- MQTT live stream ---------- */
  useEffect(() => {
    const client = mqtt.connect(MQTT_URL, {
      username: MQTT_USER,
      password: MQTT_PASS,
      clean: true,
      connectTimeout: 5000
    });

    client.on("connect", () => {
      setMqttOK(true);
      client.subscribe(TOPIC_DATA);
    });

    client.on("offline", () => setMqttOK(false));
    client.on("error", () => setMqttOK(false));

    client.on("message", (_, payload) => {
      try {
        const j = JSON.parse(payload.toString());
        setLive({
          moisture: String(j.moisture),
          temperature: String(j.temperature),
          humidity: String(j.humidity),
          pump: j.pump_status
        });
      } catch (e) {
        console.log("JSON parse err", e.message);
      }
    });

    return () => client.end();
  }, []);

  /* ---------- ThingSpeak history ---------- */
  const fetchHist = useCallback(async () => {
    if (!TS_CHANNEL || TS_CHANNEL === 0) return; // channel not set
    try {
      const url = `https://api.thingspeak.com/channels/${TS_CHANNEL}/feeds.json?results=40${TS_READ_KEY ? `&api_key=${TS_READ_KEY}` : ""}`;
      const { data } = await axios.get(url);
      const labels: string[] = [];
      const vals: number[] = [];
      data.feeds.forEach(f => {
        const v = Number(f.field1);
        if (!isNaN(v)) {
          labels.push(new Date(f.created_at).toLocaleTimeString().slice(0,5));
          vals.push(v);
        }
      });
      if (vals.length > 1) setHist({ labels, moisture: vals });
    } catch (e) { console.log("TS fetch", e.message); }
  }, []);

  useEffect(() => {
    fetchHist();
    const id = setInterval(fetchHist, 60000);
    return () => clearInterval(id);
  }, [fetchHist]);

  /* ---------- manual watering publish ---------- */
  const runManual = () => {
    const client = mqtt.connect(MQTT_URL, { username: MQTT_USER, password: MQTT_PASS, clean: true, connectTimeout: 4000 });
    client.on("connect", () => {
      client.publish(TOPIC_MAN, `RUN:${duration}`, {}, () => client.end());
    });
  };

  /* ---------- UI ---------- */
  return (
    <SafeAreaView style={styles.root}>
      <Text style={styles.h1}>🌿 Smart Watering</Text>
      <Text style={{ color: mqttOK ? "green" : "orange" }}>{mqttOK ? "MQTT live" : "History mode"}</Text>

      <View style={styles.statRow}>
        <Stat label="Moisture" value={live.moisture} />
        <Stat label="Temp °C" value={live.temperature} />
        <Stat label="Hum %" value={live.humidity} />
      </View>
      <Text style={{ marginTop: 4 }}>Pump: {live.pump}</Text>

      {/* Moisture chart */}
      {hist.moisture.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 20 }}>
          <LineChart
            data={{ labels: hist.labels, datasets: [{ data: hist.moisture }] }}
            width={chartWidth}
            height={220}
            withDots={false}
            segments={4}
            chartConfig={{
              backgroundGradientFrom: "#fff",
              backgroundGradientTo: "#fff",
              color: () => "rgba(16,185,129,1)",
              decimalPlaces: 0,
            }}
            bezier
            style={{ borderRadius: 16 }}
          />
        </ScrollView>
      )}

      {/* Manual control */}
      <View style={styles.pickerRow}>
        <Picker selectedValue={duration} onValueChange={setDuration} style={{ flex: 1 }}>
          {[5, 10, 20, 30, 60].map(s => (
            <Picker.Item label={`${s} sec`} value={`${s}`} key={s} />
          ))}
        </Picker>
        <TouchableOpacity style={styles.btn} onPress={runManual}>
          <Text style={styles.btnText}>Run Pump</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

