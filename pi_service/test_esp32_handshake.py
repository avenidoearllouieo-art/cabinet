
import secrets
import time
import serial

PORT = "COM7"
BAUD =57600

nonce = secrets.token_hex(8)
ser = serial.Serial()
ser.port = PORT
ser.baudrate = BAUD
ser.timeout = 3
ser.write_timeout = 1
ser.dtr = False
ser.rts = False

try:
    ser.open()
    ser.dtr = False
    ser.rts = False
    time.sleep(2)
    ser.reset_input_buffer()

    print(f"Port: {PORT} at {BAUD} baud")
    print("Sending HELLO only; no motor command will be sent.")

    ser.write(f"HELLO,2,{nonce}\n".encode("ascii"))
    ser.flush()

    deadline = time.monotonic() + 5
    matched = False

    while time.monotonic() < deadline:
        raw = ser.readline()
        if not raw:
            continue

        print("RX:", repr(raw))

        try:
            fields = raw.decode("ascii").strip().split(",")
        except UnicodeDecodeError:
            continue

        if (
            len(fields) == 6
            and fields[0] == "READY"
            and fields[1] == "2"
            and fields[2]
            and fields[3] == nonce
            and fields[4].isdigit()
            and fields[5] in ("IDLE", "MOVING", "DRAINING")
        ):
            matched = True
            print("HANDSHAKE RESPONSE RECEIVED.")
            print("Device state:", fields[5])

            if fields[5] != "IDLE":
                print("STOP: device is not reporting IDLE.")

            break

    if not matched:
        print("No matching READY response within 5 seconds.")

finally:
    if ser.is_open:
        ser.close()
    print("Serial port closed.")
