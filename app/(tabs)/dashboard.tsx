import { Picker } from "@react-native-picker/picker";
import axios from "axios";
import { StatusBar } from 'expo-status-bar';
import mqtt from "mqtt";
import { useCallback, useEffect, useState } from "react";
import { Dimensions, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
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
// 🔴  Set your ThingSpeak channel ID in an environment variable or config file for better security and flexibility
const TS_CHANNEL = Number(process.env.EXPO_PUBLIC_TS_CHANNEL) || 2989896; 
const TS_READ_KEY = process.env.EXPO_PUBLIC_TS_READ_KEY || "";      // leave "" if channel is public

// MQTT — HiveMQ Cloud over WebSocket
const MQTT_URL  = "wss://a1eef8be216949238865abfec7ed13a2.s1.eu.hivemq.cloud:8884/mqtt";
const MQTT_USER = "Balmee";
const MQTT_PASS = "WateringP1ant";
const TOPIC_DATA = "watering/data";
const TOPIC_MAN  = "watering/manual";
/* =============================================================== */

export default function Dashboard() {
  /* ---------- state ---------- */
  type LiveState = {
    moisture: number | null;
    temperature: number | null;
    humidity: number | null;
    pump: string;
  };
  const [live, setLive] = useState<LiveState>({
    moisture: null,
    temperature: null,
    humidity: null,
    pump: "-",
  });
  const [hist, setHist] = useState<{
  labels: string[];
  moisture: number[];
  temp: number[];
  hum: number[];
}>({ labels: [], moisture: [], temp: [], hum: [] });
  const [duration, setDuration] = useState<string>("20");
  const [mqttOK, setMqttOK] = useState(false);
  const chartWidth = Dimensions.get("window").width - 40;
  const [mqttClient, setMqttClient] = useState<any>(null);

  /* ---------- MQTT live stream ---------- */
  useEffect(() => {
    const client = mqtt.connect(MQTT_URL, {
      username: MQTT_USER,
      password: MQTT_PASS,
      clean: true,
      connectTimeout: 5000
    });
    setMqttClient(client);

    client.on("connect", () => {
      setMqttOK(true);
      client.subscribe(TOPIC_DATA);
    });

    client.on("offline", () => setMqttOK(false));
    client.on("error", () => setMqttOK(false));

    client.on("message", (_, payload: any) => {
      try {
        const j = JSON.parse(payload.toString());
        setLive({
          moisture: typeof j.moisture === "number" ? j.moisture : Number(j.moisture),
          temperature: typeof j.temperature === "number" ? j.temperature : Number(j.temperature),
          humidity: typeof j.humidity === "number" ? j.humidity : Number(j.humidity),
          pump: String(j.pump_status)
        });
      } catch (e) {
        if (e instanceof Error) {
          console.log("JSON parse err", e.message);
        } else {
          console.log("JSON parse err", e);
        }
      }
    });

    return () => {
      client.end();
    };
  }, []);

  /* ---------- ThingSpeak history ---------- */
  const fetchHist = useCallback(async () => {
    if (!TS_CHANNEL) return;
    try {
      const url =
        `https://api.thingspeak.com/channels/${TS_CHANNEL}/feeds.json?results=40` +
        (TS_READ_KEY ? `&api_key=${TS_READ_KEY}` : "");
      const { data } = await axios.get(url);

      const lbls: string[] = [];
      const mVals: number[] = [];
      const tVals: number[] = [];
      const hVals: number[] = [];

      data.feeds.forEach(
        (f: { created_at: string; field1: string; field2: string; field3: string }) => {
          lbls.push(new Date(f.created_at).toLocaleTimeString().slice(0, 5));

          const m = Number(f.field1);
          const t = Number(f.field2);
          const h = Number(f.field3);

          mVals.push(isNaN(m) ? 0 : m);
          tVals.push(isNaN(t) ? 0 : t);
          hVals.push(isNaN(h) ? 0 : h);
        }
      );

      setHist({ labels: lbls, moisture: mVals, temp: tVals, hum: hVals });
    } catch (e) {
      console.log("TS fetch", e);
    }
  }, []);

  useEffect(() => {
    fetchHist();
    const id = setInterval(fetchHist, 60000);
    return () => clearInterval(id);
  }, [fetchHist]);

  /* ---------- manual watering publish ---------- */
  const runManual = () => {
    if (mqttClient && mqttClient.connected) {
      mqttClient.publish(TOPIC_MAN, `RUN:${duration}`);
    } else {
      console.log("MQTT client not connected");
    }
  };

  /* ---------- collapsible panel state ---------- */
  const [showMoist, setShowMoist] = useState(true);
  const [showTemp, setShowTemp] = useState(false);
  const [showHum, setShowHum] = useState(false);

  const chartCfg = {
    backgroundGradientFrom: "#fff",
    backgroundGradientTo: "#fff",
    color: () => "rgba(16,185,129,1)",
    decimalPlaces: 0,
    labelColor: () => "#888",
    propsForLabels: { fontSize: 10 },
  };


    /* ---------- UI ---------- */
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={styles.h1}>🌿 Smart Watering</Text>
        <Text style={{ color: mqttOK ? "green" : "orange", textAlign: "center" }}>
          {mqttOK ? "MQTT live" : "History mode"}
        </Text>

        <View style={styles.statRow}>
          <Stat label="Moisture" value={live.moisture?.toString() ?? "-"} />
          <Stat label="Temp °C" value={live.temperature?.toString() ?? "-"} />
          <Stat label="Hum %" value={live.humidity?.toString() ?? "-"} />
        </View>
        <Text style={{ marginTop: 4, textAlign: "center" }}>Pump: {live.pump}</Text>

                {/* ──────── Moisture Panel ──────── */}
        <View style={styles.panel}>
          <TouchableOpacity onPress={() => setShowMoist(!showMoist)} style={styles.panelHeader}>
            <Text style={styles.panelTitle}>Moisture {showMoist ? "▾" : "▸"}</Text>
          </TouchableOpacity>

          {showMoist && hist.moisture.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <LineChart
                data={{
                  labels: hist.labels.map((l, i) => (i % 5 === 0 ? l : "")),
                  datasets: [{ data: hist.moisture }],
                }}
                width={chartWidth + 60}
                height={220}
                withDots={false}
                segments={4}
                yLabelsOffset={8}
                chartConfig={chartCfg}
                bezier
                style={styles.chart}
              />
            </ScrollView>
          )}
        </View>

        {/* ──────── Temperature Panel ──────── */}
        <View style={styles.panel}>
          <TouchableOpacity onPress={() => setShowTemp(!showTemp)} style={styles.panelHeader}>
            <Text style={styles.panelTitle}>Temperature °C {showTemp ? "▾" : "▸"}</Text>
          </TouchableOpacity>

          {showTemp && hist.temp.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <LineChart
                data={{
                  labels: hist.labels.map((l, i) => (i % 5 === 0 ? l : "")),
                  datasets: [{ data: hist.temp }],
                }}
                width={chartWidth + 60}
                height={220}
                withDots={false}
                segments={4}
                yLabelsOffset={8}
                chartConfig={chartCfg}
                bezier
                style={styles.chart}
              />
            </ScrollView>
          )}
        </View>

        {/* ──────── Humidity Panel ──────── */}
        <View style={styles.panel}>
          <TouchableOpacity onPress={() => setShowHum(!showHum)} style={styles.panelHeader}>
            <Text style={styles.panelTitle}>Humidity % {showHum ? "▾" : "▸"}</Text>
          </TouchableOpacity>

          {showHum && hist.hum.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <LineChart
                data={{
                  labels: hist.labels.map((l, i) => (i % 5 === 0 ? l : "")),
                  datasets: [{ data: hist.hum }],
                }}
                width={chartWidth + 60}
                height={220}
                withDots={false}
                segments={4}
                yLabelsOffset={8}
                chartConfig={chartCfg}
                bezier
                style={styles.chart}
              />
            </ScrollView>
          )}
        </View>

        {/* ──────── Duration Picker + Button ──────── */}
        <Picker
          selectedValue={duration}
          onValueChange={(v) => setDuration(String(v))}
          style={styles.picker}
        >
          {["5", "10", "20", "30", "60"].map((s) => (
            <Picker.Item label={`${s} sec`} value={s} key={s} />
          ))}
        </Picker>

        <TouchableOpacity style={styles.btn} onPress={runManual}>
          <Text style={styles.btnText}>Run Pump</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ---------- Stat component ---------- */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ alignItems: "center", flex: 1 }}>
      <Text style={{ fontSize: 16, color: "#888" }}>{label}</Text>
      <Text style={{ fontSize: 22, fontWeight: "bold", color: "#10b981" }}>{value}</Text>
    </View>
  );
}

/* ---------- Styles ---------- */
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#fff",
    paddingTop: 40,
    paddingHorizontal: 16,
  },
  h1: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 16,
    textAlign: "center",
    color: "#333",
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginVertical: 16,
  },
  picker: {
    height: 50,
    width: "100%",
    marginTop: 16,
  },
  btn: {
    backgroundColor: "#10b981",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 16,
  },
  btnText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 18,
  },
  panel: { marginTop: 12 },
  panelHeader: { paddingVertical: 6 },
  panelTitle: { fontSize: 16, fontWeight: "bold" },
  chart: { borderRadius: 16 },

});
