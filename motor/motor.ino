#include <Arduino.h>
#include <esp_system.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#define STEP1 4
#define DIR1  5
#define STEP2 6
#define DIR2  7

static const uint8_t PROTOCOL_VERSION = 2;
static const size_t MAX_FRAME_BYTES = 96;
static const uint32_t TEST_STEPS = 200;
static const uint32_t PULSE_HALF_PERIOD_US = 1000;
static const uint32_t PARTIAL_FRAME_TIMEOUT_MS = 250;
static const uint32_t POST_MOTION_DRAIN_MS = 100;

// Bench prototype only: session IDs and transaction high-water state are RAM-only.
// There is no HMAC, durable journal, anti-rollback protection, or position sensor.

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
  Serial.println(reason);
}

void sendResponse(uint32_t transactionId, const char *status, char command, const char *reason = nullptr) {
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
  transactionId = static_cast<uint32_t>(parsed);
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

void beginMovement(uint32_t transactionId, char command) {
  activeTransactionId = transactionId;
  activeCommand = command;
  stepsRemaining = TEST_STEPS;
  stepIsHigh = false;

  switch (command) {
    case '1': activeStepPin = STEP1; activeDirectionPin = DIR1; digitalWrite(DIR1, HIGH); break;
    case '2': activeStepPin = STEP1; activeDirectionPin = DIR1; digitalWrite(DIR1, LOW); break;
    case '3': activeStepPin = STEP2; activeDirectionPin = DIR2; digitalWrite(DIR2, HIGH); break;
    case '4': activeStepPin = STEP2; activeDirectionPin = DIR2; digitalWrite(DIR2, LOW); break;
    default: return;
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
  Serial.println(stateName);
  handshakeComplete = true;
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

  // Transaction IDs are consumed even for busy rejection, so that a line
  // received during motion cannot become executable after the motor stops.
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
    sendResponse(activeTransactionId, "DONE", activeCommand);
    activeTransactionId = 0;
    activeCommand = 0;
    motorState = MotorState::IDLE;
  }
}

void setup() {
  // Preload low before enabling output mode. External pull-downs/driver enable
  // circuitry are still required because MCU pins float during reset.
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

  const uint64_t randomSession = (static_cast<uint64_t>(esp_random()) << 32) | esp_random();
  snprintf(sessionId, sizeof(sessionId), "%016llx", static_cast<unsigned long long>(randomSession));

  Serial.begin(115200);
  resetFrame();
  lastFrameByteMs = millis();
  lastMotionInputMs = millis();
}

void loop() {
  serviceSerialInput();
  expirePartialFrame();
  serviceMotor();
}