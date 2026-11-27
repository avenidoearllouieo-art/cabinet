// TapTrack ESP32-S3 — OPEN-ONLY, 2 upper-limit NC switches BENCH TEST.
// One switch each: Station 1 OPEN(GPIO15), Station 2 OPEN(GPIO17).
// LA38 low-voltage, isolated NC sensing contact on GPIO12 + GND.
// Only v2 Raspberry Pi commands '1' (S1 OPEN), '3' (S2 OPEN) are allowed.
// Commands '2' and '4' are explicitly REJECTED: BENCH_OPEN_ONLY.
// No CLOSE motion and no GPIO16/18 limit input reads in this test.
// Original motor PUL/DIR and V2 movement protocol unchanged.
// STATUS reports latched stop and both OPEN inputs to the updated Pi controller.
// WARNING: Bench test with both motors mechanically separated from the door.
// A GPIO software stop is not a hardwired emergency stop. Use appropriate
// independent hardware stopping; never operate a suspended shutter with this.
// Power down before making or changing any electrical connection.

#include <Arduino.h>
#if !defined(ARDUINO_USB_CDC_ON_BOOT) || ARDUINO_USB_CDC_ON_BOOT != 1 || !defined(ARDUINO_USB_MODE) || ARDUINO_USB_MODE != 1
#error "Select USB CDC On Boot: Enabled and USB Mode: Hardware CDC and JTAG"
#endif
#include <esp_system.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#define STEP1 4
#define DIR1  5
#define STEP2 6
#define DIR2  7

// Only TWO upper / OPEN switches are used in this temporary firmware.
// Wiring: NC contact pair to the GPIO and ESP32 GND (ME-8108 terminals 1-2,
// when confirmed on your unit with a continuity meter).
// IMPORTANT: STOP_BUTTON requires a SEPARATE isolated NC low-voltage contact
// from GPIO12 to ESP32 GND. The mains E-stop terminals cannot connect to ESP32.
// When that isolated contact is unavailable, motion remains blocked.
#define S1_UP_LIMIT   15
#define S2_UP_LIMIT   17
#define STOP_BUTTON   12

static const uint8_t PROTOCOL_VERSION = 2;
static const size_t MAX_FRAME_BYTES = 96;
static const uint32_t TEST_STEPS = 200;  // Last user-shared file had 200; keep your actual bench setting.
static const uint32_t PULSE_HALF_PERIOD_US = 1000;
static const uint32_t PARTIAL_FRAME_TIMEOUT_MS = 250;
static const uint32_t POST_MOTION_DRAIN_MS = 100;

// NC switch to GND, pinMode(INPUT_PULLUP):
// LOW  = contact is closed (normal), HIGH = pressed or broken/open circuit.
static bool contactOpen(uint8_t pin) {
  return digitalRead(pin) == HIGH;
}

// OPEN-only commands. Confirm the original DIR=HIGH actually opens your
// particular motor arrangement BEFORE attaching anything to the roll-up door.
// '1' = Station 1 OPEN (DIR1 HIGH)
// '3' = Station 2 OPEN (DIR2 HIGH)
// '2' and '4' = refused; there are no CLOSE limit switches in this test.
static uint8_t targetLimitPin(char command) {
  return command == '1' ? S1_UP_LIMIT : S2_UP_LIMIT;
}

enum class MotorState : uint8_t {
  IDLE,
  MOVING,
  DRAINING,
};

MotorState motorState = MotorState::IDLE;
char sessionId[17] = {0};
bool handshakeComplete = false;
uint32_t lastTransactionId = 0;
char lastTransactionCommand = 0;

char frameBuffer[MAX_FRAME_BYTES] = {0};
size_t frameLength = 0;
bool discardingFrame = false;
bool frameStartedBusy = false;
const char *discardReason = "BAD_FRAME";
uint32_t lastFrameByteMs = 0;

uint8_t activeStepPin = STEP1;
uint8_t activeDirectionPin = DIR1;
char activeCommand = 0;
uint32_t activeTransactionId = 0;
uint32_t stepsRemaining = 0;
uint32_t nextStepAtUs = 0;
uint32_t lastMotionInputMs = 0;
bool stepIsHigh = false;

// Software bench-stop latch. It remains latched until ESP32 restart;
// releasing the button does NOT automatically rearm it.
bool stopLatched = false;
const char *motionFinalStatus = "DONE";
const char *motionFinalReason = nullptr;

bool isLowerHex(const char *value, size_t expectedLength) {
  if (strlen(value) != expectedLength) return false;
  for (size_t index = 0; index < expectedLength; ++index) {
    const char character = value[index];
    if (!((character >= '0' && character <= '9') ||
          (character >= 'a' && character <= 'f'))) {
      return false;
    }
  }
  return true;
}

void sendError(const char *reason) {
  Serial.print("ERR,2,");
  Serial.print(sessionId);
  Serial.print(',');
  Serial.print(reason);
  Serial.write('\n');
}

void sendResponse(uint32_t transactionId, const char *status, char command,
                  const char *reason = nullptr) {
  Serial.print("RSP,2,");
  Serial.print(sessionId);
  Serial.print(',');
  Serial.print(transactionId);
  Serial.print(',');
  Serial.print(status);
  Serial.print(',');
  Serial.print(command);
  if (reason != nullptr) {
    Serial.print(',');
    Serial.print(reason);
  }
  Serial.write('\n');
}

bool parseTransactionId(const char *value, uint32_t &transactionId) {
  const size_t length = strlen(value);
  if (length == 0 || length > 10 || (value[0] == '0' && length > 1)) return false;
  uint32_t parsed = 0;
  for (size_t index = 0; value[index] != '\0'; ++index) {
    if (value[index] < '0' || value[index] > '9') return false;
    const uint32_t digit = static_cast<uint8_t>(value[index] - '0');
    if (parsed > (UINT32_MAX - digit) / 10) return false;
    parsed = parsed * 10 + digit;
  }
  if (parsed == 0) return false;
  transactionId = parsed;
  return true;
}

size_t splitFields(char *line, char *fields[], size_t maxFields) {
  size_t count = 0;
  char *fieldStart = line;
  for (char *cursor = line;; ++cursor) {
    if (*cursor == ',' || *cursor == '\0') {
      if (count >= maxFields || cursor == fieldStart) return 0;
      fields[count++] = fieldStart;
      if (*cursor == '\0') break;
      *cursor = '\0';
      fieldStart = cursor + 1;
    }
  }
  return count;
}

void rejectCommand(uint32_t transactionId, char command, const char *reason) {
  sendResponse(transactionId, "REJECTED", command, reason);
}

// Stop issuing pulses and finish a currently active transaction without claiming
// successful travel for an E-stop or sensor fault. This is NOT a hardware E-stop.
void haltMotion(const char *status, const char *reason) {
  digitalWrite(activeStepPin, LOW);
  stepIsHigh = false;
  stepsRemaining = 0;
  motionFinalStatus = status;
  motionFinalReason = reason;
  if (motorState == MotorState::MOVING) {
    motorState = MotorState::DRAINING;
    lastMotionInputMs = millis();
  }
}

void serviceSafetyInputs() {
  if (contactOpen(STOP_BUTTON)) {
    stopLatched = true;
  }
  if (stopLatched) {
    if (motorState == MotorState::MOVING) {
      haltMotion("ABORTED", "STOP_LATCHED");
    } else if (motorState == MotorState::DRAINING) {
      motionFinalStatus = "ABORTED";
      motionFinalReason = "STOP_LATCHED";
    }
    return;
  }
  if (motorState == MotorState::MOVING &&
      contactOpen(targetLimitPin(activeCommand))) {
    // HIGH means the OPEN limit was reached, or its NC circuit disconnected.
    // Stop the motor pulses and do NOT report a successful full door travel.
    haltMotion("ABORTED", "LIMIT_INPUT_OPEN");
  }
}

void beginMovement(uint32_t transactionId, char command) {
  // Refuse CLOSE explicitly: the corresponding safety limit inputs are absent.
  if (command != '1' && command != '3') {
    rejectCommand(transactionId, command, "BENCH_OPEN_ONLY");
    return;
  }
  serviceSafetyInputs();
  if (stopLatched) {
    rejectCommand(transactionId, command, "STOP_LATCHED");
    return;
  }
  if (contactOpen(targetLimitPin(command))) {
    rejectCommand(transactionId, command, "TARGET_LIMIT_ACTIVE");
    return;
  }

  activeTransactionId = transactionId;
  activeCommand = command;
  stepsRemaining = TEST_STEPS;
  stepIsHigh = false;
  motionFinalStatus = "DONE";
  motionFinalReason = nullptr;

  switch (command) {
    case '1': activeStepPin = STEP1; activeDirectionPin = DIR1; digitalWrite(DIR1, HIGH); break;
    case '3': activeStepPin = STEP2; activeDirectionPin = DIR2; digitalWrite(DIR2, HIGH); break;
    default: return; // Defensive: commands 2 and 4 were already rejected.
  }

  motorState = MotorState::MOVING;
  nextStepAtUs = micros() + 10000;
  sendResponse(transactionId, "ACCEPTED", command);
  sendResponse(transactionId, "BUSY", command);
}

void processHello(char *fields[], size_t count) {
  if (count != 3 || strcmp(fields[0], "HELLO") != 0) {
    sendError("BAD_FRAME");
    return;
  }
  if (strcmp(fields[1], "2") != 0) {
    sendError("BAD_VERSION");
    return;
  }
  if (!isLowerHex(fields[2], 16)) {
    sendError("BAD_NONCE");
    return;
  }
  const char *stateName = motorState == MotorState::IDLE
                              ? "IDLE"
                              : motorState == MotorState::MOVING ? "MOVING" : "DRAINING";
  Serial.print("READY,2,");
  Serial.print(sessionId);
  Serial.print(',');
  Serial.print(fields[2]);
  Serial.print(',');
  Serial.print(lastTransactionId);
  Serial.print(',');
  Serial.print(stateName);
  Serial.write('\n');
  handshakeComplete = true;
}

// Read-only V2 safety status. Does not arm, clear the stop latch,
// advance the transaction counter, or generate movement pulses.
void processStatus(char *fields[], size_t count) {
  if (!handshakeComplete) {
    sendError("HELLO_REQUIRED");
    return;
  }
  if (count != 3 || strcmp(fields[0], "STATUS") != 0) {
    sendError("BAD_FRAME");
    return;
  }
  if (strcmp(fields[1], "2") != 0) {
    sendError("BAD_VERSION");
    return;
  }
  if (!isLowerHex(fields[2], 16)) {
    sendError("BAD_NONCE");
    return;
  }

  serviceSafetyInputs();
  const bool limit1Open = contactOpen(S1_UP_LIMIT);
  const bool limit2Open = contactOpen(S2_UP_LIMIT);
  const char *stateName = motorState == MotorState::IDLE
                              ? "IDLE"
                              : motorState == MotorState::MOVING ? "MOVING" : "DRAINING";
  Serial.print("STATE,2,");
  Serial.print(sessionId);
  Serial.print(',');
  Serial.print(fields[2]);
  Serial.print(',');
  Serial.print(lastTransactionId);
  Serial.print(',');
  Serial.print(stateName);
  Serial.print(',');
  Serial.print(stopLatched ? '1' : '0');
  Serial.print(',');
  Serial.print(limit1Open ? '1' : '0');
  Serial.print(',');
  Serial.print(limit2Open ? '1' : '0');
  Serial.print(",BENCH_OPEN_ONLY");
  Serial.write('\n');
}

void processCommand(char *fields[], size_t count, bool startedBusy) {
  if (!handshakeComplete) {
    sendError("HELLO_REQUIRED");
    return;
  }
  if (count != 5 || strcmp(fields[0], "CMD") != 0) {
    sendError("BAD_FRAME");
    return;
  }
  if (strcmp(fields[1], "2") != 0) {
    sendError("BAD_VERSION");
    return;
  }

  uint32_t transactionId = 0;
  if (!parseTransactionId(fields[3], transactionId)) {
    sendError("BAD_TRANSACTION");
    return;
  }
  if (fields[4][0] == '\0' || fields[4][1] != '\0' ||
      (fields[4][0] < '1' || fields[4][0] > '4')) {
    rejectCommand(transactionId, fields[4][0], "BAD_COMMAND");
    return;
  }
  const char command = fields[4][0];
  if (strcmp(fields[2], sessionId) != 0) {
    rejectCommand(transactionId, command, "STALE_SESSION");
    return;
  }

  if (transactionId <= lastTransactionId) {
    rejectCommand(transactionId, command,
                  transactionId == lastTransactionId && command == lastTransactionCommand
                      ? "DUPLICATE_TRANSACTION"
                      : "STALE_TRANSACTION");
    return;
  }

  lastTransactionId = transactionId;
  lastTransactionCommand = command;
  if (startedBusy || motorState != MotorState::IDLE) {
    rejectCommand(transactionId, command, "BUSY");
    return;
  }
  beginMovement(transactionId, command);
}

void processFrame(bool startedBusy) {
  frameBuffer[frameLength] = '\0';
  char *fields[6] = {nullptr};
  const size_t count = splitFields(frameBuffer, fields, 6);
  if (count == 0) {
    sendError(discardReason);
    return;
  }
  if (strcmp(fields[0], "HELLO") == 0) {
    processHello(fields, count);
  } else if (strcmp(fields[0], "STATUS") == 0) {
    processStatus(fields, count);
  } else if (strcmp(fields[0], "CMD") == 0) {
    processCommand(fields, count, startedBusy);
  } else {
    sendError("UNEXPECTED_FRAME");
  }
}

void resetFrame() {
  frameLength = 0;
  discardingFrame = false;
  frameStartedBusy = false;
  discardReason = "BAD_FRAME";
}

void serviceSerialInput() {
  while (Serial.available() > 0) {
    // Check the STOP input even while processing incoming USB data.
    serviceSafetyInputs();
    const int incoming = Serial.read();
    if (incoming < 0) return;
    const char value = static_cast<char>(incoming);
    lastFrameByteMs = millis();
    lastMotionInputMs = lastFrameByteMs;

    if (frameLength == 0 && !discardingFrame) {
      frameStartedBusy = motorState != MotorState::IDLE;
    }
    if (value == '\n') {
      if (discardingFrame) {
        sendError(discardReason);
      } else if (frameLength == 0) {
        sendError("EMPTY_FRAME");
      } else {
        processFrame(frameStartedBusy);
      }
      resetFrame();
      continue;
    }
    if (value == '\r' || value == '\0' || value < 0x20 || value > 0x7e) {
      discardingFrame = true;
      discardReason = "BAD_FRAME";
      frameLength = 0;
      continue;
    }
    if (discardingFrame) continue;
    if (frameLength >= MAX_FRAME_BYTES - 1) {
      discardingFrame = true;
      discardReason = "FRAME_TOO_LONG";
      frameLength = 0;
      continue;
    }
    frameBuffer[frameLength++] = value;
  }
}

void expirePartialFrame() {
  if ((frameLength > 0 || discardingFrame) &&
      static_cast<uint32_t>(millis() - lastFrameByteMs) > PARTIAL_FRAME_TIMEOUT_MS) {
    discardingFrame = true;
    frameLength = 0;
    discardReason = "PARTIAL_FRAME";
  }
}

void serviceMotor() {
  serviceSafetyInputs();  // check before every potential step edge
  if (motorState == MotorState::MOVING) {
    const uint32_t now = micros();
    if (static_cast<int32_t>(now - nextStepAtUs) < 0) return;

    if (!stepIsHigh) {
      digitalWrite(activeStepPin, HIGH);
      stepIsHigh = true;
      nextStepAtUs = now + PULSE_HALF_PERIOD_US;
      return;
    }

    digitalWrite(activeStepPin, LOW);
    stepIsHigh = false;
    nextStepAtUs = now + PULSE_HALF_PERIOD_US;
    if (--stepsRemaining == 0) {
      digitalWrite(activeStepPin, LOW);
      motorState = MotorState::DRAINING;
      lastMotionInputMs = millis();
    }
    return;
  }

  if (motorState == MotorState::DRAINING && frameLength == 0 && !discardingFrame &&
      Serial.available() == 0 &&
      static_cast<uint32_t>(millis() - lastMotionInputMs) >= POST_MOTION_DRAIN_MS) {
    sendResponse(activeTransactionId, motionFinalStatus, activeCommand, motionFinalReason);
    activeTransactionId = 0;
    activeCommand = 0;
    motorState = MotorState::IDLE;
  }
}

void setup() {
  // Step outputs retain their prior assignments. Driver outputs may float while
  // the ESP32 starts; external safe wiring/driver control is still necessary.
  digitalWrite(STEP1, LOW);
  digitalWrite(DIR1, LOW);
  digitalWrite(STEP2, LOW);
  digitalWrite(DIR2, LOW);
  pinMode(STEP1, OUTPUT);
  pinMode(DIR1, OUTPUT);
  pinMode(STEP2, OUTPUT);
  pinMode(DIR2, OUTPUT);
  digitalWrite(STEP1, LOW);
  digitalWrite(DIR1, LOW);
  digitalWrite(STEP2, LOW);
  digitalWrite(DIR2, LOW);

  pinMode(S1_UP_LIMIT, INPUT_PULLUP);
  pinMode(S2_UP_LIMIT, INPUT_PULLUP);
  pinMode(STOP_BUTTON, INPUT_PULLUP);
  stopLatched = contactOpen(STOP_BUTTON);

  const uint64_t randomSession = (static_cast<uint64_t>(esp_random()) << 32) | esp_random();
  snprintf(sessionId, sizeof(sessionId), "%016llx", static_cast<unsigned long long>(randomSession));

  Serial.begin(115200);
  resetFrame();
  lastFrameByteMs = millis();
  lastMotionInputMs = millis();
}

void loop() {
  serviceSafetyInputs();
  serviceSerialInput();
  expirePartialFrame();
  serviceMotor();
  // Yield only while idle, as in the working USB diagnostic.
  // No added delay during step generation or post-motion drain.
  if (motorState == MotorState::IDLE) {
    delay(1);
  }
}
