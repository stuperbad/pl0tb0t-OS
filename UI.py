#! /usr/bin/env python3
# This program should be the main drawing interface from svg to the plotter, via a serial connection.

import board
import RPi.GPIO as GPIO
import os
import threading
import time
import argparse
from adafruit_seesaw.seesaw import Seesaw 
from adafruit_seesaw.analoginput import AnalogInput
from adafruit_seesaw import neopixel

import pygame 

from art import ArtproofDrawing, intialize_pygame
import stream

plot_lock = threading.Lock()
plotfile = None
def plot_thread(plotter_port):
    global plotfile, plot_lock
    if plotter_port:
        plot = stream.open_port_and_home(plotter_port, verbose=False)
    while True:
        plot_lock.acquire()
        f = plotfile
        plot_lock.release()
        if f:
            if plotter_port:
                stream.stream_gcode(plot, open(f), verbose=False)
            else:
                #fake serial sending by just sleeping
                time.sleep(20)
            plot_lock.acquire()
            plotfile = None
            plot_lock.release()
        else:
            time.sleep(0.1)

def main( screen, drawing, seedstart=0):
    global plotfile, plot_lock
    '''
    This what runs the event loop

    Args:
        screen: the pygame screen object
        drawing: the art object
    '''


        #GENERATE ART
        drawing.draw()
        pygame.display.flip()
        
        if (not plot_busy) and GPIO.input(btnR_pin) == GPIO.HIGH: #PRINTING
            fname = "drawing_{seed}".format(seed=seed)
            fname_svg = fname+".svg"
            fname_gcode = fname+".gcode"

            #block while generating GCODE
            drawing.to_svg(fname_svg)
            os.system("vpype read {filename} scaleto 4.5in 4.5in layout -m .5in -v top 5.5x7in linesimplify -t 0.05mm write {filename}".format(filename=fname_svg)) #format the created svg to a 5x7 layout
            os.system("vpype read opensauce2024-signature.svg scaleto 4.05in 1.05in layout -h center -v bottom 5.5x6.5in read {filename} write {filename}".format(filename=fname_svg)) #add the signature svg
            os.system("vpype -c test_party_config.cfg read {svg} linemerge linesort gwrite -p test_party_config {gcode}".format(svg=fname_svg, gcode=fname_gcode)) #create gcode from merged file

            #signal to serial thread new gcode is available
            plot_lock.acquire()
            plotfile = fname_gcode
            plot_lock.release()

            seed += 1
            last_printed_values = values

            #block while generating SVG (and gcode as a time delay for legibility
            drawing.to_svg(fname_svg)
            os.system("vpype read {filename} scaleto 4.5in 4.5in layout -m .5in -v top 5.5x7in linesimplify -t 0.05mm write {filename}".format(filename=fname_svg)) #format the created svg to a 5x7 layout
            os.system("vpype read party_signature.svg scaleto 4.05in 1.05in layout -h center -v bottom 5.5x6.5in read {filename} write {filename}".format(filename=fname_svg)) #add the signature svg
            os.system("vpype -c test_party_config.cfg read {svg} linemerge linesort gwrite -p test_party_config {gcode}".format(svg=fname_svg, gcode=fname_gcode)) #create gcode from merged file
 
            seed += 1
            last_printed_values = values

        # UPDATE LEDS
        for i, pixel in enumerate(pixels):
            pixel.fill(
                (0, 0, min(255, max(potentiometer_to_color(values[i]), 0)))
                )

        #UPDATE SCREEN
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                pygame.quit()
                return
        
        clock.tick(FPS)


if __name__ == "__main__":

    parser = argparse.ArgumentParser(description="run the Pl0tb0t")
    parser.add_argument('-n', '--no-plotter', default=False, action="store_true", dest="noplotter", help="don't actually talk to Pl0tb0t, just fake plotting with a timeer")
    parser.add_argument('-p', '--port', default='/dev/ttyUSB0', action="store", help="use PORT for Pl0tb0t connection", metavar='PORT')
    parser.add_argument('-s', '--seed', default=0, action="store", type=int, help="set seed value start position to avoid file overwrites")
    args = parser.parse_args()


    DRAW_DIMENSIONS = (600,600)

    # initialization
    screen = intialize_pygame(SCREEN_DIMENSIONS) #reference to the pygame screen object
    pixels = initialize_pixels(sliders) # references to the LEDs
    initialize_GPIO(INPUT1_PIN, INPUT2_PIN)
    port = args.port if not args.noplotter else None
    plotter_thread = threading.Thread(target=plot_thread, args=(port,), daemon=True)
    plotter_thread.start()

    drawing = ArtproofDrawing(dimensions=DRAW_DIMENSIONS, values=[pot.value for pot in pots], screen = screen) # the art object

    # main loop
    main( screen=screen, drawing=drawing, seedstart=args.seed)
