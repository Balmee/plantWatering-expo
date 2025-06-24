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
 *     Open Command prompt into Direcrtory:
 *     cd plantWatering-expo
 * 
 *     Dependencies (install once):
 *     npm install
 * 
 *     Open and run mobile app:
 *     npx expo start
 *
 ************************************************/

/* ==================  CONFIG  ================== */
// ThingSpeak channel ID must be NUMERIC (not the API key!)
// Setting ThingSpeak channel ID in an environment variable for better security and flexibility
const TS_CHANNEL = Number(process.env.EXPO_PUBLIC_TS_CHANNEL) || 2989896; 
const TS_READ_KEY = process.env.EXPO_PUBLIC_TS_READ_KEY || "";      // leave "" since channel is public

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
  temperature: number[];
  humidity: number[];
}>({
  labels: [],
  moisture: [],
  temperature: [],
  humidity: [],
});

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
          moisture: typeof j.moist === "number" ? j.moist : Number(j.moist),
          temperature: typeof j.temp === "number" ? j.temp : Number(j.temp),
          humidity: typeof j.hum === "number" ? j.hum : Number(j.hum),
          pump: String(j.pump)
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

      const labels: string[] = [];
      const moistVals: number[] = [];
      const tempVals: number[] = [];
      const humVals: number[] = [];

      data.feeds.forEach((f: { field1: string; field2: string; field3: string; created_at: string }) => {
        const moist = Number(f.field1);
        const temp = Number(f.field2);
        const hum  = Number(f.field3);
        if (!isNaN(moist)) moistVals.push(moist);
        if (!isNaN(temp))  tempVals.push(temp);
        if (!isNaN(hum))   humVals.push(hum);
        labels.push(new Date(f.created_at).toLocaleTimeString().slice(0, 5));
      });

      setHist({
        labels,
        moisture: moistVals,
        temperature: tempVals,
        humidity: humVals,
      });

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

  /* ---------- Chart Preprocessing ---------- */
  const maxMoist = Math.max(...hist.moisture);
  const yMaxMoist = Math.ceil((maxMoist + 1) / 5) * 5;
  const paddedMoist = [...hist.moisture, yMaxMoist];

  const maxTemp = Math.max(...hist.temperature);
  const yMaxTemp = Math.ceil((maxTemp + 1) / 5) * 5;
  const paddedTemp = [...hist.temperature, yMaxTemp];

  const maxHum = Math.max(...hist.humidity);
  const yMaxHum = Math.ceil((maxHum + 1) / 5) * 5;
  const paddedHum = [...hist.humidity, yMaxHum];



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

        {/* ---------- Moisture Panel ---------- */}
        <View style={styles.panel}>
          <TouchableOpacity onPress={() => setShowMoist(!showMoist)} style={styles.panelHeader}>
            <Text style={styles.panelTitle}>Moisture {showMoist ? "▾" : "▸"}</Text>
          </TouchableOpacity>

          {showMoist && hist.moisture.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Text style={styles.chartTitle}>📈 Moisture History</Text>
              <LineChart
                data={{
                  labels: hist.labels.map((label, i) => (i % 5 === 0 ? label : "")),
                  datasets: [{ data: paddedMoist }],
                }}
                width={chartWidth}
                height={220}
                fromZero
                withDots={false}
                segments={5}
                chartConfig={{
                  backgroundGradientFrom: "#fff",
                  backgroundGradientTo: "#fff",
                  color: () => "#10b981",
                  decimalPlaces: 0,
                  propsForLabels: {
                    fontSize: 10,
                  },
                }}
                bezier
                style={{ borderRadius: 16 }}
              />
            </ScrollView>
          )}
        </View>

        {/* ---------- Temperature Panel ---------- */}
        <View style={styles.panel}>
          <TouchableOpacity onPress={() => setShowTemp(!showTemp)} style={styles.panelHeader}>
            <Text style={styles.panelTitle}>Temperature °C {showTemp ? "▾" : "▸"}</Text>
          </TouchableOpacity>

          {showTemp && hist.temperature.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Text style={styles.chartTitle}>🌡️ Temperature History</Text>
              <LineChart
                data={{
                  labels: hist.labels.map((label, i) => (i % 5 === 0 ? label : "")),
                  datasets: [{ data: paddedTemp }],
                }}
                width={chartWidth}
                height={220}
                fromZero
                yAxisSuffix="°C"
                withDots={false}
                segments={5}
                chartConfig={{
                  backgroundGradientFrom: "#fff",
                  backgroundGradientTo: "#fff",
                  color: () => "#f97316",
                  decimalPlaces: 1,
                  propsForLabels: {
                    fontSize: 10,
                  },
                }}
                bezier
                style={{ borderRadius: 16 }}
              />
            </ScrollView>
          )}
        </View>

        {/* ---------- Humidity Panel ---------- */}
        <View style={styles.panel}>
          <TouchableOpacity onPress={() => setShowHum(!showHum)} style={styles.panelHeader}>
            <Text style={styles.panelTitle}>Humidity % {showHum ? "▾" : "▸"}</Text>
          </TouchableOpacity>

          {showHum && hist.humidity.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Text style={styles.chartTitle}>💧 Humidity History</Text>
              <LineChart
                data={{
                  labels: hist.labels.map((label, i) => (i % 5 === 0 ? label : "")),
                  datasets: [{ data: paddedHum }],
                }}
                width={chartWidth}
                height={220}
                fromZero
                yAxisSuffix="%"
                withDots={false}
                segments={5}
                chartConfig={{
                  backgroundGradientFrom: "#fff",
                  backgroundGradientTo: "#fff",
                  color: () => "#3b82f6",
                  decimalPlaces: 0,
                  propsForLabels: {
                    fontSize: 10,
                  },
                }}
                bezier
                style={{ borderRadius: 16 }}
              />
            </ScrollView>
          )}
        </View>

        {/* ---------- Duration Picker + Button ---------- */}
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
  chartTitle: {
  fontWeight: "bold",
  fontSize: 16,
  marginTop: 24,
  marginBottom: 8,
},

});
