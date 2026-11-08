
import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView,
  Switch, SafeAreaView, TouchableOpacity, ActivityIndicator
} from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

const BATTERY_CAPACITY = 2000;
const MAX_SOLAR_INPUT = 1200;
const SOLAR_ARRAY_CAPACITY = 1100;
const CHARGING_EFFICIENCY = 0.85;
const DISCHARGE_EFFICIENCY = 0.85;

const supabase = createClient(
  'https://ktgpcuxuvvuccneoymjc.supabase.co',
  'sb_publishable_tvuiyl3pAk-0SaJniywroA_mdbZhsX9',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false
    }
  }
);

const appliances = [
  { name: 'Air Conditioner', watts: 900 },
  { name: 'Refrigerator', watts: 150 },
  { name: 'Television', watts: 100 },
  { name: 'Standing Fan', watts: 75 },
  { name: 'Lights', watts: 40 },
  { name: 'Decoder & Wi-Fi', watts: 30 },
  { name: 'Laptop', watts: 65 }
];

function dateKey(value) {
  const d = new Date(value);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0')
  ].join('-');
}

function monthKey(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function groupReadings(readings, getKey) {
  const groups = {};

  readings.forEach(item => {
    const key = getKey(item.created_at);
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });

  return Object.entries(groups)
    .map(([period, items]) => {
      const values = items.map(x => x.battery_percentage);

      return {
        period,
        count: items.length,
        average: Math.round(
          values.reduce((a, b) => a + b, 0) / values.length
        ),
        highest: Math.max(...values),
        lowest: Math.min(...values),
        latest: items[0].battery_percentage
      };
    })
    .sort((a, b) => b.period.localeCompare(a.period));
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function formatHours(value) {
  if (!Number.isFinite(value) || value < 0) return '--';

  const hours = Math.floor(value);
  const minutes = Math.round((value - hours) * 60);

  if (hours === 0) return `${minutes} minutes`;
  if (minutes === 0) return `${hours} hours`;

  return `${hours} hours ${minutes} minutes`;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [registerMode, setRegisterMode] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const [battery, setBattery] = useState('85');
  const [solar, setSolar] = useState('');
  const [selected, setSelected] = useState([]);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setMessage(error.message);
      setUser(data?.session?.user || null);
      setChecking(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user || null);
      }
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user) loadReadings();
    else setHistory([]);
  }, [user]);

  async function loadReadings() {
    const { data, error } = await supabase
      .from('battery_readings')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) {
      setMessage('Could not load readings: ' + error.message);
    } else {
      setHistory(data || []);
    }
  }

  async function handleAuth() {
    if (!email.trim() || !password) {
      setMessage('Enter your email and password.');
      return;
    }

    if (password.length < 6) {
      setMessage('Your password must be at least 6 characters.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      if (registerMode) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password
        });

        if (error) throw error;

        if (!data.session) {
          setMessage(
            'Registration received. Check your email to confirm your account, then log in.'
          );
        } else {
          setMessage('Account created successfully.');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password
        });

        if (error) throw error;
        setMessage('Login successful.');
      }
    } catch (error) {
      setMessage(error.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    const { error } = await supabase.auth.signOut();

    if (error) setMessage(error.message);
    else setMessage('');
  }

  async function saveReading() {
    const batteryValue = Number(battery);
    const solarValue = solar.trim() === '' ? null : Number(solar);

    if (
      battery.trim() === '' ||
      !Number.isInteger(batteryValue) ||
      batteryValue < 0 ||
      batteryValue > 100
    ) {
      setMessage('Enter a whole battery percentage from 0 to 100.');
      return;
    }

    if (
      solarValue !== null &&
      (!Number.isFinite(solarValue) ||
        solarValue < 0 ||
        solarValue > 1200)
    ) {
      setMessage('Enter a solar reading between 0 and 1,200W.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      const { error } = await supabase
        .from('battery_readings')
        .insert({
          user_id: user.id,
          battery_percentage: batteryValue,
          solar_input_watts: solarValue
        });

      if (error) throw error;

      setMessage('Battery reading saved to your account.');
      await loadReadings();
    } catch (error) {
      setMessage('Could not save: ' + error.message);
    } finally {
      setBusy(false);
    }
  }

  async function generatePDF() {
    if (history.length === 0) {
      setMessage('Save at least one battery reading before generating a report.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      const daily = groupReadings(history, dateKey);
      const monthly = groupReadings(history, monthKey);

      const dailyRows = daily.map(item => `
        <tr>
          <td>${escapeHTML(item.period)}</td>
          <td>${item.count}</td>
          <td>${item.average}%</td>
          <td>${item.highest}%</td>
          <td>${item.lowest}%</td>
        </tr>
      `).join('');

      const monthlyRows = monthly.map(item => `
        <tr>
          <td>${escapeHTML(item.period)}</td>
          <td>${item.count}</td>
          <td>${item.average}%</td>
          <td>${item.highest}%</td>
          <td>${item.lowest}%</td>
        </tr>
      `).join('');

      const html = `
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body {
              font-family: Arial, sans-serif;
              padding: 24px;
              color: #20352b;
            }
            h1 { color: #23865b; }
            h2 {
              color: #23865b;
              margin-top: 30px;
            }
            p { font-size: 12px; }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 12px;
              font-size: 11px;
            }
            th, td {
              border: 1px solid #cbd5ce;
              padding: 9px 5px;
              text-align: center;
            }
            th { background: #e1f2e8; }
            .footer {
              margin-top: 40px;
              color: #60766a;
            }
          </style>
        </head>
        <body>
          <h1>DND ITEL SOLAR MONITOR</h1>
          <h3>Battery Performance Report</h3>
          <p>Account: ${escapeHTML(user.email)}</p>
          <p>Generator: Itel IESS-1K20N | 2000Wh</p>
          <p>Solar panels: 2 x 550W bifacial panels</p>
          <p>Report generated: ${escapeHTML(new Date().toLocaleString())}</p>
          <p>Total readings included: ${history.length}</p>

          <h2>Daily Battery Reports</h2>
          <table>
            <tr>
              <th>Date</th>
              <th>Readings</th>
              <th>Average</th>
              <th>Highest</th>
              <th>Lowest</th>
            </tr>
            ${dailyRows}
          </table>

          <h2>Monthly Battery Reports</h2>
          <table>
            <tr>
              <th>Month</th>
              <th>Readings</th>
              <th>Average</th>
              <th>Highest</th>
              <th>Lowest</th>
            </tr>
            ${monthlyRows}
          </table>

          <p class="footer">
            DND MULTIPURPOSE CO. LTD<br/>
            SMART SOLAR MANAGEMENT
          </p>
        </body>
        </html>
      `;

      const file = await Print.printToFileAsync({ html });
      const available = await Sharing.isAvailableAsync();

      if (available) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Share DND Battery Report'
        });

        setMessage('Your PDF report is ready.');
      } else {
        setMessage('PDF created, but sharing is unavailable on this device.');
      }
    } catch (error) {
      setMessage('PDF report error: ' + error.message);
    } finally {
      setBusy(false);
    }
  }

  // BATTERY AND SOLAR CALCULATIONS

  const batteryNumber = Math.max(
    0,
    Math.min(100, Number(battery) || 0)
  );

  const solarNumber = solar.trim() === '' ? null : Number(solar);

  const validSolar = solarNumber !== null &&
    Number.isFinite(solarNumber) &&
    solarNumber >= 0 &&
    solarNumber <= MAX_SOLAR_INPUT;

  const load = appliances
    .filter(a => selected.includes(a.name))
    .reduce((sum, a) => sum + a.watts, 0);

  const remainingEnergy = Math.round(
    BATTERY_CAPACITY * batteryNumber / 100
  );

  const usableEnergy = Math.round(
    remainingEnergy * DISCHARGE_EFFICIENCY
  );

  const runtime = load > 0
    ? formatHours(usableEnergy / load)
    : '--';

  const chargingHours =
    validSolar && solarNumber > 0 && batteryNumber < 100
      ? (
          BATTERY_CAPACITY * (100 - batteryNumber) / 100
        ) / (solarNumber * CHARGING_EFFICIENCY)
      : null;

  const chargingTime = batteryNumber >= 100
    ? 'Battery is full'
    : chargingHours !== null
      ? formatHours(chargingHours)
      : '--';

  const chargingRate = validSolar && solarNumber > 0
    ? (
        solarNumber * CHARGING_EFFICIENCY /
        BATTERY_CAPACITY * 100
      ).toFixed(1)
    : '--';

  // Performance compared with the 1,100W solar array rating.
  const arrayPerformance = validSolar
    ? Math.round(solarNumber / SOLAR_ARRAY_CAPACITY * 100)
    : null;

  // Performance compared with the generator's 1,200W PV limit.
  const solarUtilization = validSolar
    ? Math.round(solarNumber / MAX_SOLAR_INPUT * 100)
    : null;

  const averageBattery = history.length > 0
    ? Math.round(
        history.reduce((sum, item) => sum + item.battery_percentage, 0)
        / history.length
      )
    : 0;

  const highestBattery = history.length > 0
    ? Math.max(...history.map(item => item.battery_percentage))
    : 0;

  const lowestBattery = history.length > 0
    ? Math.min(...history.map(item => item.battery_percentage))
    : 0;

  const chartHistory = [...history].slice(0, 7).reverse();
  const dailyReports = groupReadings(history, dateKey);
  const monthlyReports = groupReadings(history, monthKey);

  let batteryAdvice = '';

  if (batteryNumber <= 20) {
    batteryAdvice = 'Battery is low. Reduce appliance usage and recharge soon.';
  } else if (batteryNumber <= 40) {
    batteryAdvice = 'Battery is getting low. Consider reducing heavy loads.';
  } else if (batteryNumber >= 90) {
    batteryAdvice = 'Battery level is high. Continue monitoring your power use.';
  } else {
    batteryAdvice = 'Battery level is in a moderate operating range.';
  }

  let solarAdvice = '';

  if (solarNumber === null || solar.trim() === '') {
    solarAdvice = 'Enter an actual measured solar input reading to see performance estimates.';
  } else if (!validSolar) {
    solarAdvice = 'The reading is outside the generator input limit. Check the value.';
  } else if (solarNumber === 0) {
    solarAdvice = 'No solar input has been recorded. Check sunlight and connections.';
  } else if (solarNumber < 200) {
    solarAdvice = 'Solar input is relatively low. Shade, sunlight and panel orientation can affect performance.';
  } else if (solarNumber > SOLAR_ARRAY_CAPACITY) {
    solarAdvice = 'Reading is above the panels’ combined 1,100W rated capacity. Verify the meter reading and conditions.';
  } else {
    solarAdvice = 'Solar input is being recorded. Performance estimates use your entered reading.';
  }

  if (checking) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#55df9a" />
        <Text style={styles.label}>Checking your account...</Text>
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.authPage}>
          <Text style={styles.brand}>DND ☀️</Text>
          <Text style={styles.heading}>ITEL SOLAR MONITOR</Text>
          <Text style={styles.sub}>Your personal solar dashboard</Text>

          <View style={styles.card}>
            <Text style={styles.section}>
              {registerMode ? 'Create Your Account' : 'Welcome Back'}
            </Text>

            <Text style={styles.label}>Email address</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your email"
              placeholderTextColor="#789589"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="At least 6 characters"
              placeholderTextColor="#789589"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            <TouchableOpacity
              style={styles.mainButton}
              onPress={handleAuth}
              disabled={busy}
            >
              <Text style={styles.buttonText}>
                {busy ? 'Please wait...' : registerMode ? 'Register' : 'Login'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setRegisterMode(!registerMode);
                setMessage('');
              }}
            >
              <Text style={styles.link}>
                {registerMode
                  ? 'Already have an account? Login'
                  : 'New here? Create an account'}
              </Text>
            </TouchableOpacity>

            {!!message && <Text style={styles.message}>{message}</Text>}
          </View>

          <Text style={styles.footer}>DND MULTIPURPOSE CO. LTD</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        <Text style={styles.brand}>DND ☀️</Text>
        <Text style={styles.heading}>ITEL SOLAR MONITOR</Text>
        <Text style={styles.sub}>IESS-1K20N | 2000Wh</Text>
        <Text style={styles.version}>VERSION 7.0 | SOLAR PERFORMANCE</Text>

        <Text style={styles.signedIn}>Signed in: {user.email}</Text>

        {battery.trim() !== '' && batteryNumber <= 20 && (
          <View style={styles.warningCard}>
            <Text style={styles.warningTitle}>⚠️ LOW BATTERY WARNING</Text>
            <Text style={styles.warningText}>
              Battery is at {batteryNumber}%. Reduce appliance usage
              and consider recharging your generator.
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.label}>BATTERY LEVEL</Text>
          <Text style={styles.big}>{battery || 0}%</Text>

          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: batteryNumber + '%' }
              ]}
            />
          </View>

          <Text style={styles.label}>
            Enter the percentage shown on your Itel display
          </Text>
        </View>

        <View style={styles.row}>
          <View style={styles.smallCard}>
            <Text style={styles.label}>POWER LOAD</Text>
            <Text style={styles.number}>{load}W</Text>
          </View>

          <View style={styles.smallCard}>
            <Text style={styles.label}>SOLAR INPUT</Text>
            <Text style={styles.number}>
              {validSolar ? solarNumber + 'W' : '—'}
            </Text>
          </View>
        </View>

        <Text style={styles.section}>Your Solar Setup</Text>

        <View style={styles.card}>
          <Text style={styles.label}>SOLAR PANEL CONFIGURATION</Text>
          <Text style={styles.number}>2 x 550W Bifacial</Text>
          <Text style={styles.insightText}>
            Combined rated panel capacity: 1,100W
          </Text>

          <View style={styles.dividerLine} />

          <Text style={styles.label}>CONNECTION TYPE</Text>
          <Text style={styles.number}>Parallel</Text>

          <View style={styles.dividerLine} />

          <Text style={styles.label}>GENERATOR MAXIMUM PV INPUT</Text>
          <Text style={styles.number}>1,200W</Text>

          <Text style={styles.insightText}>
            Your panel array is rated at 1,100W, within the generator's
            stated 1,200W maximum PV power. Voltage and current limits
            must also be respected.
          </Text>
        </View>

        <Text style={styles.section}>Smart Battery Monitoring</Text>

        <View style={styles.card}>
          <Text style={styles.label}>ESTIMATED ENERGY REMAINING</Text>
          <Text style={styles.big}>{remainingEnergy} Wh</Text>
          <Text style={styles.label}>
            Approximate stored energy based on a 2,000Wh battery
          </Text>

          <View style={styles.dividerLine} />

          <Text style={styles.label}>ESTIMATED USABLE ENERGY</Text>
          <Text style={styles.number}>{usableEnergy} Wh</Text>
          <Text style={styles.label}>
            Uses an estimated 85% usable-energy allowance
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>ESTIMATED TIME TO FULL CHARGE</Text>
          <Text style={styles.big}>{chargingTime}</Text>
          <Text style={styles.label}>
            Based on your manually entered solar input of{' '}
            {validSolar ? solarNumber + 'W' : 'no recorded watts'}
          </Text>

          <View style={styles.dividerLine} />

          <Text style={styles.label}>ESTIMATED CHARGING RATE</Text>
          <Text style={styles.number}>
            {chargingRate === '--' ? '--' : chargingRate + '% per hour'}
          </Text>
        </View>

        <Text style={styles.section}>Solar Charging Performance</Text>

        <View style={styles.card}>
          <Text style={styles.label}>ARRAY PERFORMANCE</Text>
          <Text style={styles.big}>
            {arrayPerformance === null ? '--' : arrayPerformance + '%'}
          </Text>

          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: Math.min(arrayPerformance || 0, 100) + '%' }
              ]}
            />
          </View>

          <Text style={styles.label}>
            Compared with your 1,100W rated panel array
          </Text>

          <View style={styles.dividerLine} />

          <Text style={styles.label}>GENERATOR PV INPUT UTILIZATION</Text>
          <Text style={styles.number}>
            {solarUtilization === null ? '--' : solarUtilization + '%'}
          </Text>

          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: Math.min(solarUtilization || 0, 100) + '%' }
              ]}
            />
          </View>

          <Text style={styles.label}>
            Compared with the generator's 1,200W maximum PV input
          </Text>

          <View style={styles.dividerLine} />

          <Text style={styles.insightHeading}>Solar performance advice</Text>
          <Text style={styles.insightText}>{solarAdvice}</Text>

          {validSolar && solarNumber > MAX_SOLAR_INPUT && (
            <Text style={styles.warningText}>
              Do not exceed the generator's specified PV input limits.
            </Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>Smart Battery Advice</Text>

          <Text style={styles.insightHeading}>Battery condition</Text>
          <Text style={styles.insightText}>{batteryAdvice}</Text>

          <Text style={styles.insightHeading}>Power usage</Text>
          <Text style={styles.insightText}>
            {load === 0
              ? 'Select appliances to calculate estimated runtime.'
              : load > 1000
                ? 'Your selected appliances exceed the 1,000W rated AC output. Reduce the load.'
                : load > 850
                  ? 'Your selected appliances are approaching the rated AC output. Be careful.'
                  : 'Your selected appliances are within the 1,000W rated AC output.'}
          </Text>

          <Text style={styles.insightHeading}>Charging advice</Text>
          <Text style={styles.insightText}>{solarAdvice}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>ESTIMATED BATTERY RUNTIME</Text>
          <Text style={styles.big}>{runtime}</Text>
          <Text style={styles.label}>
            Based on current battery level and selected appliances
          </Text>
        </View>

        <Text style={styles.section}>Battery Settings</Text>
        <Text style={styles.label}>Enter battery percentage manually</Text>

        <TextInput
          style={styles.input}
          value={battery}
          onChangeText={setBattery}
          keyboardType="number-pad"
          placeholder="Enter battery percentage"
          placeholderTextColor="#789589"
          maxLength={3}
        />

        <Text style={styles.section}>Solar Input</Text>
        <Text style={styles.label}>
          Enter actual measured solar input watts (optional)
        </Text>

        <TextInput
          style={styles.input}
          placeholder="Enter measured solar watts"
          placeholderTextColor="#789589"
          keyboardType="numeric"
          value={solar}
          onChangeText={setSolar}
        />

        <Text style={styles.label}>
          Do not enter the panel's 1,100W rated capacity unless that is
          the actual measured input at that time.
        </Text>

        <TouchableOpacity
          style={styles.mainButton}
          onPress={saveReading}
          disabled={busy}
        >
          <Text style={styles.buttonText}>
            {busy ? 'Saving...' : 'Save Battery Reading'}
          </Text>
        </TouchableOpacity>

        {!!message && <Text style={styles.message}>{message}</Text>}

        <Text style={styles.section}>Appliance Manager</Text>
        <Text style={styles.label}>
          Select the appliances you want to use
        </Text>

        {appliances.map(a => (
          <View style={styles.appliance} key={a.name}>
            <View>
              <Text style={styles.name}>{a.name}</Text>
              <Text style={styles.label}>{a.watts} Watts</Text>
            </View>

            <Switch
              value={selected.includes(a.name)}
              onValueChange={v => setSelected(old =>
                v ? [...old, a.name] : old.filter(x => x !== a.name)
              )}
            />
          </View>
        ))}

        <View style={styles.card}>
          <Text style={styles.label}>POWER SAFETY MONITOR</Text>

          {load > 1000 ? (
            <>
              <Text style={styles.warningTitle}>🚨 OVERLOAD WARNING!</Text>
              <Text style={styles.warningText}>
                Your selected appliances total {load}W. This exceeds
                the generator's 1,000W rated AC output. Reduce the load.
              </Text>
            </>
          ) : load > 850 ? (
            <>
              <Text style={styles.highLoadTitle}>
                ⚠️ HIGH LOAD - BE CAREFUL
              </Text>
              <Text style={styles.warningText}>
                Your current load is {load}W. You are approaching
                the 1,000W rated AC output.
              </Text>
            </>
          ) : (
            <Text style={styles.safeTitle}>✓ WITHIN RATED LIMIT</Text>
          )}

          <Text style={styles.label}>Rated AC output: 1,000W</Text>
        </View>

        <Text style={styles.section}>Battery History Dashboard</Text>

        <View style={styles.row}>
          <View style={styles.smallCard}>
            <Text style={styles.label}>AVERAGE BATTERY</Text>
            <Text style={styles.number}>
              {history.length ? averageBattery + '%' : '--'}
            </Text>
          </View>

          <View style={styles.smallCard}>
            <Text style={styles.label}>LATEST READING</Text>
            <Text style={styles.number}>
              {history.length ? history[0].battery_percentage + '%' : '--'}
            </Text>
          </View>
        </View>

        <View style={styles.row}>
          <View style={styles.smallCard}>
            <Text style={styles.label}>HIGHEST RECORDED</Text>
            <Text style={styles.number}>
              {history.length ? highestBattery + '%' : '--'}
            </Text>
          </View>

          <View style={styles.smallCard}>
            <Text style={styles.label}>LOWEST RECORDED</Text>
            <Text style={styles.number}>
              {history.length ? lowestBattery + '%' : '--'}
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>Recent Battery Trend</Text>
          <Text style={styles.label}>Your latest 7 saved readings</Text>

          {chartHistory.length === 0 ? (
            <Text style={styles.label}>No readings available.</Text>
          ) : chartHistory.map(item => (
            <View style={styles.chartItem} key={item.id}>
              <Text style={styles.chartDate}>
                {new Date(item.created_at).toLocaleDateString()}
              </Text>

              <View style={styles.chartTrack}>
                <View
                  style={[
                    styles.chartBar,
                    { width: item.battery_percentage + '%' }
                  ]}
                />
              </View>

              <Text style={styles.chartValue}>
                {item.battery_percentage}%
              </Text>
            </View>
          ))}
        </View>

        <Text style={styles.section}>Daily Battery Reports</Text>

        {dailyReports.length === 0 ? (
          <Text style={styles.label}>No daily reports yet.</Text>
        ) : dailyReports.slice(0, 7).map(item => (
          <View style={styles.historyItem} key={item.period}>
            <Text style={styles.name}>{item.period}</Text>
            <Text style={styles.label}>Readings: {item.count}</Text>
            <Text style={styles.label}>
              Average: {item.average}% | Highest: {item.highest}%
            </Text>
            <Text style={styles.label}>Lowest: {item.lowest}%</Text>
          </View>
        ))}

        <Text style={styles.section}>Monthly Battery Reports</Text>

        {monthlyReports.length === 0 ? (
          <Text style={styles.label}>No monthly reports yet.</Text>
        ) : monthlyReports.slice(0, 12).map(item => (
          <View style={styles.historyItem} key={item.period}>
            <Text style={styles.name}>{item.period}</Text>
            <Text style={styles.label}>Readings: {item.count}</Text>
            <Text style={styles.label}>
              Average: {item.average}% | Highest: {item.highest}%
            </Text>
            <Text style={styles.label}>Lowest: {item.lowest}%</Text>
          </View>
        ))}

        <View style={styles.card}>
          <Text style={styles.section}>Export Your Report</Text>
          <Text style={styles.label}>
            Create a PDF containing your daily and monthly battery reports.
          </Text>

          <TouchableOpacity
            style={styles.mainButton}
            onPress={generatePDF}
            disabled={busy}
          >
            <Text style={styles.buttonText}>
              {busy ? 'Preparing...' : 'Generate & Share PDF Report'}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.section}>Saved Battery History</Text>

        {history.length === 0 ? (
          <Text style={styles.label}>No saved readings yet.</Text>
        ) : history.map(item => (
          <View style={styles.historyItem} key={item.id}>
            <Text style={styles.name}>
              Battery: {item.battery_percentage}%
            </Text>
            <Text style={styles.label}>
              Solar input: {item.solar_input_watts ?? 'Not entered'}W
            </Text>
            <Text style={styles.label}>
              {new Date(item.created_at).toLocaleString()}
            </Text>
          </View>
        ))}

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={loadReadings}
        >
          <Text style={styles.buttonText}>Refresh History</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={logout}
        >
          <Text style={styles.buttonText}>Log Out</Text>
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          Smart estimates are calculations based on manually entered
          readings and assumed efficiency. They are not live readings
          from your generator and actual performance may vary.
        </Text>

        <Text style={styles.footer}>
          DND MULTIPURPOSE CO. LTD {'\n'}
          SMART SOLAR MANAGEMENT {'\n'}
          Version 7.0 | Solar Performance Monitoring
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#101b19',
    padding: 10
  },
  authPage: {
    flexGrow: 1,
    justifyContent: 'center'
  },
  brand: {
    color: '#55df9a',
    fontSize: 30,
    fontWeight: 'bold',
    marginTop: 20,
    textAlign: 'center'
  },
  heading: {
    color: 'white',
    fontSize: 21,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 5
  },
  sub: {
    color: '#a4b9ae',
    textAlign: 'center',
    marginBottom: 10
  },
  version: {
    color: '#55df9a',
    textAlign: 'center',
    fontSize: 11,
    marginBottom: 12
  },
  signedIn: {
    color: '#55df9a',
    textAlign: 'center',
    marginBottom: 10
  },
  card: {
    backgroundColor: '#1c3029',
    margin: 10,
    padding: 20,
    borderRadius: 15
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-around'
  },
  smallCard: {
    backgroundColor: '#1c3029',
    padding: 15,
    borderRadius: 15,
    width: '45%',
    marginVertical: 5
  },
  label: {
    color: '#a4b9ae',
    fontSize: 12,
    marginVertical: 5
  },
  big: {
    color: '#55df9a',
    fontSize: 30,
    fontWeight: 'bold'
  },
  number: {
    color: 'white',
    fontSize: 23,
    fontWeight: 'bold'
  },
  section: {
    color: 'white',
    fontSize: 19,
    fontWeight: 'bold',
    margin: 15
  },
  appliance: {
    backgroundColor: '#1c3029',
    marginHorizontal: 10,
    marginVertical: 4,
    padding: 14,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  name: {
    color: 'white',
    fontSize: 15,
    fontWeight: 'bold'
  },
  input: {
    backgroundColor: '#1c3029',
    color: 'white',
    padding: 14,
    marginHorizontal: 10,
    marginVertical: 6,
    borderRadius: 10
  },
  mainButton: {
    backgroundColor: '#23865b',
    padding: 15,
    borderRadius: 10,
    margin: 10,
    alignItems: 'center'
  },
  secondaryButton: {
    backgroundColor: '#345348',
    padding: 14,
    borderRadius: 10,
    margin: 10,
    alignItems: 'center'
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    textAlign: 'center'
  },
  link: {
    color: '#55df9a',
    textAlign: 'center',
    marginTop: 20
  },
  message: {
    color: '#55df9a',
    textAlign: 'center',
    margin: 12
  },
  historyItem: {
    backgroundColor: '#1c3029',
    padding: 12,
    marginHorizontal: 10,
    marginVertical: 4,
    borderRadius: 10
  },
  warningCard: {
    backgroundColor: '#542522',
    padding: 16,
    margin: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ff5555'
  },
  warningTitle: {
    color: '#ff6969',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 6
  },
  warningText: {
    color: 'white',
    fontSize: 13,
    lineHeight: 20
  },
  highLoadTitle: {
    color: '#ffc45c',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 6
  },
  safeTitle: {
    color: '#55df9a',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 6
  },
  chartItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8
  },
  chartDate: {
    color: '#a4b9ae',
    fontSize: 10,
    width: 75
  },
  chartTrack: {
    flex: 1,
    height: 12,
    backgroundColor: '#101b19',
    borderRadius: 8,
    overflow: 'hidden'
  },
  chartBar: {
    height: 12,
    backgroundColor: '#55df9a',
    borderRadius: 8
  },
  chartValue: {
    color: 'white',
    fontSize: 12,
    width: 40,
    textAlign: 'right'
  },
  progressTrack: {
    height: 14,
    backgroundColor: '#101b19',
    borderRadius: 10,
    overflow: 'hidden',
    marginVertical: 12
  },
  progressFill: {
    height: 14,
    backgroundColor: '#55df9a',
    borderRadius: 10
  },
  dividerLine: {
    height: 1,
    backgroundColor: '#345348',
    marginVertical: 15
  },
  insightHeading: {
    color: '#55df9a',
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 12
  },
  insightText: {
    color: 'white',
    fontSize: 13,
    lineHeight: 21,
    marginTop: 5
  },
  disclaimer: {
    color: '#ffc45c',
    fontSize: 11,
    lineHeight: 18,
    margin: 15,
    textAlign: 'center'
  },
  footer: {
    color: '#789589',
    textAlign: 'center',
    margin: 25,
    lineHeight: 23
  }
});




