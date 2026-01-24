#!/usr/bin/env python
"""\

Stream g-code to grbl controller

This script differs from the simple_stream.py script by 
tracking the number of characters in grbl's serial read
buffer. This allows grbl to fetch the next line directly
from the serial buffer and does not have to wait for a 
response from the computer. This effectively adds another
buffer layer to prevent buffer starvation.

CHANGELOG:
- 20140714: Updated baud rate to 115200. Added a settings
  write mode via simple streaming method. MIT-licensed.

TODO: 
- Add runtime command capabilities

---------------------
The MIT License (MIT)

Copyright (c) 2012-2014 Sungeun K. Jeon

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
---------------------
"""

import serial
import re
import time
import sys
import argparse
# import threading

RX_BUFFER_SIZE = 128

def wait_idle(port, verbose=False):
    resp = "Busy"
    while not resp.startswith("<Idle"):
        port.write(b"?\n")
        resp = port.readline().decode('UTF8')
        while not resp.startswith("<"):
            time.sleep(0.1)
            resp = port.readline().decode('UTF8')
        if verbose:
            print("status: " + resp)

def open_port_and_home(portname, verbose=False):
    s = serial.Serial(portname, 115200, timeout=1.0)

    time.sleep(2)
    # Wake up grbl
    if verbose:
        print("Initializing grbl...")
    # Wait for grbl to initialize and flush startup text in serial input
    for _ in range(3):
        init_str = s.readline().decode('UTF8')
        if verbose:
            print(init_str)

    #home machine
    s.write(b'$H\r\n')
    line=s.readline().decode('UTF8')
    while not 'ok' in line:
        line=s.readline().decode('UTF8')
    wait_idle(s, verbose)

    return s

def stream_settings(port, file, verbose=False):
    # Stream g-code to grbl
    l_count = 0
    # Send settings file via simple call-response streaming method. Settings must be streamed
    # in this manner since the EEPROM accessing cycles shut-off the serial interrupt.
    if verbose:
        print("SETTINGS MODE: Streaming", args.gcode_file.name, " to ", args.device_file)
    for line in file:
        l_count += 1 # Iterate line counter
        # l_block = re.sub('\s|\(.*?\)','',line).upper() # Strip comments/spaces/new line and capitalize
        l_block = line.strip() # Strip all EOL characters for consistency
        if verbose: print('SND: ' + str(l_count) + ':' + l_block)
        port.write(l_block.encode('utf-8') + b'\n') # Send g-code block to grbl
        grbl_out = port.readline().strip() # Wait for grbl response with carriage return
        if verbose: print('REC:', grbl_out)

def stream_gcode(port, file, verbose=False):
# Stream g-code to grbl
    l_count = 0
    # Send g-code program via a more agressive streaming protocol that forces characters into
    # Grbl's serial read buffer to ensure Grbl has immediate access to the next g-code command
    # rather than wait for the call-response serial protocol to finish. This is done by careful
    # counting of the number of characters sent by the streamer to Grbl and tracking Grbl's 
    # responses, such that we never overflow Grbl's serial read buffer. 
    g_count = 0
    c_line = []
    # periodic() # Start status report periodic timer
    for line in file:
        l_count += 1 # Iterate line counter
        # l_block = re.sub('\s|\(.*?\)','',line).upper() # Strip comments/spaces/new line and capitalize
        l_block = line.strip()
        c_line.append(len(l_block)+1) # Track number of characters in grbl serial read buffer
        grbl_out = ''
        while sum(c_line) >= RX_BUFFER_SIZE-1 | port.inWaiting() :
            out_temp = port.readline().decode("UTF8").strip() # Wait for grbl response
            if verbose: print("T:",out_temp)
            if out_temp.find('ok') < 0 and out_temp.find('error') < 0 :
                print("  Debug: ",out_temp) # Debug response
            else :
                grbl_out += out_temp;
                g_count += 1 # Iterate g-code counter
                grbl_out += str(g_count); # Add line finished indicator
                #del c_line[0] # Delete the block character count corresponding to the last 'ok'
                c_line.pop(0) # Delete the block character count corresponding to the last 'ok'
        if verbose: print("SND: " + str(l_count) + " : " + l_block)
        port.write(l_block.encode('utf-8') + b'\n') # Send g-code block to grbl
        if verbose : print("BUF:",str(sum(c_line)),"REC:",grbl_out)

    #read rest of responses
    for _ in c_line:
        out_temp = port.readline().decode("UTF8").strip() # Wait for grbl response
        while len(out_temp)>0:
            if verbose:
                print("REC:",out_temp)
            out_temp = port.readline().decode("UTF8").strip() # Wait for grbl response
    #wait for final commands to finish
    wait_idle(port, verbose)
    #final "ok" once idle
    out_temp = port.readline().decode("UTF8").strip() # Wait for grbl response
    if verbose:
        print("REC:",out_temp)
        print("G-code streaming finished!\n")


if __name__ == "__main__":
    # Define command line argument interface
    parser = argparse.ArgumentParser(description='Stream g-code file to grbl. (pySerial and argparse libraries required)')
    parser.add_argument('gcode_file', type=argparse.FileType('r'),
            help='g-code filename to be streamed')
    parser.add_argument('device_file',
            help='serial device path')
    parser.add_argument('-v','--verbose',action='store_true', default=False,
            help='suppress output text')
    parser.add_argument('-s','--settings',action='store_true', default=False,
            help='settings write mode')        
    args = parser.parse_args()

    # Initialize
    s = open_port_and_home(args.device_file, args.verbose)
    f = args.gcode_file
    
    if args.settings :
        stream_settings(s, f, args.verbose)
    else:
        stream_gcode(s, f, args.verbose)

    # Wait for user input after streaming is completed
    #print("WARNING: Wait until grbl completes buffered g-code blocks before exiting.")
    #raw_input("  Press <Enter> to exit and disable grbl.") 


    # Close file and serial port
    f.close()
    s.close()
