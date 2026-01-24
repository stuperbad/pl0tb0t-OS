#! /usr/bin/env python3
# this file generates the art
import cairo
import math
import pygame
import random
import svgwrite
import numpy as np

def intialize_pygame(dimensions): 
    '''
    This sets up the pygame window
    '''
    pygame.init()
    pygame.display.set_caption("Art Generator")
    screen = pygame.display.set_mode(dimensions)
    #screen = pygame.display.set_mode((0,0), pygame.FULLSCREEN)

    return screen


def rect_coord_from_center_radius(center, radius):
    '''
    Return corners of a square rectangle centered at center with given radius
    '''

    return (center[0] - radius, center[1] - radius, 2*radius, 2*radius)

def xy_from_center_radius_theta(center, radius, theta):
    '''
    Return the xy coordinates of the point on the circle with given center and radius at the given angle

    Args:
        center: (x, y) tuple
        radius: float
        theta: float in radians
    '''

    return center[0] + radius * math.cos(-theta), center[1] + radius * math.sin(-theta)

def svg_arc(dwg, position, radius, rad_start, rad_end, color="black"):
        
    x0, y0 = position[0] + radius, position[1]
    x1, y1 = position[0] + radius, position[1]
    x0 -= (1 - math.cos(-rad_start)) * radius
    y0 += math.sin(-rad_start) * radius
    x1 -= (1 - math.cos(-rad_end)) * radius
    y1 += math.sin(-rad_end) * radius

    args = {'x0': x0,
            'y0': y0,
            'x1': x1,
            'y1': y1,
            'xradius': radius,
            'yradius': radius,
            'ellipseRotation': 0,
            'sweep': 0,
            'large': 1 if rad_end - rad_start > math.pi else 0,
    }

    path = """M %(x0)f,%(y0)f A %(xradius)f,%(yradius)f %(ellipseRotation)f %(large)d,%(sweep)d %(x1)f,%(y1)f""" % args

    arc = dwg.path(d=path, fill="none", stroke=color, stroke_width=3)
    dwg.add(arc)

    # start/end points, just for reference
    # dwg.add(dwg.circle((x0, y0), r=2, stroke="green", fill="green"))
    # dwg.add(dwg.circle((x1, y1), r=2, stroke="red", fill="red"))

class Element:
    LINE_COLOR = (0, 0, 0)
    def __init__(self): 
        pass 
    
    def draw(self, screen):
        '''
        Draws the element on the screen. 

        Args:
            screen: the pygame screen object
        '''
        pass

    def to_svg(self): 
        '''
        Returns the SVG representation of the element
        '''
        pass


class Slice(Element):

    def __init__(self, center, start_theta, end_theta, start_radius, end_radius, has_fill = False, fill_factor=4):

        self.center = center
        self.start_theta = start_theta
        self.end_theta = end_theta
        self.start_radius = start_radius
        self.end_radius = end_radius
        self.has_fill = has_fill
        self.fill_factor = fill_factor

        # Coordinates of the corners of the slice
        self.inner_start_xy = xy_from_center_radius_theta(self.center, self.start_radius, self.start_theta)
        self.outer_start_xy = xy_from_center_radius_theta(self.center, self.end_radius, self.start_theta)

        self.inner_end_xy = xy_from_center_radius_theta(self.center, self.start_radius, self.end_theta) # problem one
        self.outer_end_xy = xy_from_center_radius_theta(self.center, self.end_radius, self.end_theta)   # problem one

        # for pygame
        self.inner_rect = pygame.Rect(rect_coord_from_center_radius(self.center, self.start_radius))
        self.outer_rect = pygame.Rect(rect_coord_from_center_radius(self.center, self.end_radius))
        
    def draw(self, screen):
        
        pygame.draw.arc(screen, self.LINE_COLOR, self.inner_rect, self.start_theta, self.end_theta, 3)
        pygame.draw.arc(screen, self.LINE_COLOR, self.outer_rect, self.start_theta, self.end_theta, 3)
        pygame.draw.line(screen, self.LINE_COLOR, self.inner_start_xy, self.outer_start_xy, 3)
        pygame.draw.line(screen, self.LINE_COLOR, self.inner_end_xy, self.outer_end_xy, 3) # problem one

        if self.has_fill: 
            width = self.end_radius - self.start_radius
            min_spacing = 2.5
            num_lines = max(math.floor(self.fill_factor * width/min_spacing), 1)
            line_spacing = width/(num_lines)
            for i in range(num_lines):
                r = self.start_radius + i*line_spacing
                pygame.draw.arc(screen, self.LINE_COLOR, rect_coord_from_center_radius(self.center, r), self.start_theta, self.end_theta, 4)


    def to_svg(self, dwg):
        
        svg_arc(dwg, self.center, self.start_radius, self.start_theta, self.end_theta, color="black")
        svg_arc(dwg, self.center, self.end_radius, self.start_theta, self.end_theta, color="black")

        dwg.add(dwg.line(self.inner_start_xy, self.outer_start_xy, stroke="black", stroke_width=3))
        dwg.add(dwg.line(self.inner_end_xy, self.outer_end_xy, stroke="black", stroke_width=3))

        if self.has_fill:
            width = self.end_radius - self.start_radius
            num_lines = math.floor(width/3)
            min_spacing = 2.5
            num_lines = max(math.floor(self.fill_factor * width/min_spacing), 1)
            line_spacing = width/(num_lines+1)

            for i in range(num_lines):
                flip = ((i%2) == 1)
                if flip:
                    start = self.end_theta
                    end = self.start_theta
                else:
                    start = self.start_theta
                    end = self.end_theta
                r = self.start_radius + line_spacing*(i+1)
                r_0 = self.start_radius + line_spacing*(i)
                p0 = xy_from_center_radius_theta(self.center, r_0, start)
                p1 = xy_from_center_radius_theta(self.center, r, start)
                dwg.add(dwg.line(p0, p1, stroke="black"))
                #svg arc drawing must be in order or it continues the long way around
                svg_arc(dwg, self.center, r, self.start_theta, self.end_theta, color="black")


class Wedge(Element): 

    def __init__(self, center, radius, start_theta, end_theta): 
        
        self.center = center
        self.radius = radius
        
        self.start_theta = start_theta
        self.end_theta = end_theta

        self.inner_start_xy = xy_from_center_radius_theta(self.center, self.radius, self.start_theta)
        self.inner_end_xy = xy_from_center_radius_theta(self.center, self.radius, self.end_theta) 
        
        self.inner_rect = pygame.Rect(rect_coord_from_center_radius(self.center, self.radius))

    def draw(self, screen): 
        pygame.draw.arc(screen, self.LINE_COLOR, self.inner_rect, self.start_theta, self.end_theta, 3)
        pygame.draw.line(screen, self.LINE_COLOR, self.center, self.inner_end_xy, 3)
        pygame.draw.line(screen, self.LINE_COLOR, self.center, self.inner_start_xy, 3)

    def to_svg(self, dwg): 
        svg_arc(dwg, self.center, self.radius, self.start_theta, self.end_theta, color="black")
        dwg.add(dwg.line(self.center, self.inner_end_xy, stroke="black", stroke_width=3))
        dwg.add(dwg.line(self.center, self.inner_start_xy, stroke="black", stroke_width=3))

class ArtproofDrawing: 

    def __init__(self, dimensions, values, screen): 
        '''
        Dimensions: (width, height)
        Values: list of values from 0 to 1023
        '''
        self.dimensions = dimensions
        self.screen = screen
        self.center = (dimensions[0]/2, dimensions[1]/2)
        self.border = 20
        self.max_radius = min(dimensions[0], dimensions[1])/2 - self.border

        self.values = []
        self.elements = []

    def update(self, values, seed=0):
        '''
        Updates the elements based on the current values

        Mapping from values to parameters: 
        0: Expected layer width (20-max_radius/2)
        1: SD of layer width (0-max_radius/5)
        2: Expected number of elements per layer (1-20)
        3: SD of number of elements per layer (0-4)
        4: Expected spacing between layers AND Fill Factor (% max fill)
        5: Probability that slice appears
        6: Probability of black fill 
        7: Expected number of wedges 
        8: Expected wedge theta size 
        9: Expected wedge radius
        '''    

        random.seed(seed)
        np.random.seed(seed)
        self.elements = []
        self.values = [value/1023 for value in values]

        curr_radius = 20

        while curr_radius < self.max_radius: # build layers
            layer_width = abs(random.gauss(self.values[0]*self.max_radius/2+20, self.values[1]*self.max_radius/5))

            if curr_radius + layer_width > self.max_radius:
                break

            num_elts_in_layer = math.floor(abs(random.gauss(self.values[2]*30, self.values[3]*5)))+1
            elt_size_in_radians = 2*3.14/num_elts_in_layer

            for j in range(num_elts_in_layer): # build elements
                if self.values[5] > random.random(): # element is included
                    fillval = True
                    #mean = a/(a+b) in [0,1]
                    #peakiness = (a+b) in (0, inf]
                    #-> a = mean * peakiness
                    #-> b = peakiness - a
                    peakiness = 1e3/(1e4*(self.values[6]**2) + 1.0/1e6)
                    a = self.values[4] * peakiness
                    b = peakiness - a
                    a = np.clip(a, 1/1e32, 1e32)
                    b = np.clip(b, 1/1e32, 1e32)
                    fill_fact = min( 1.0, max(np.random.beta(a,b), 0))**2
                    elt = Slice(self.center, j*elt_size_in_radians, (j+1)*elt_size_in_radians, curr_radius, curr_radius + layer_width, has_fill = fillval, fill_factor = fill_fact)
                    self.elements.append(elt)
            
            curr_radius += layer_width + abs(random.gauss(self.values[4], self.values[4]/5))

        num_wedges = math.floor(abs(random.gauss(self.values[7]*16, self.values[7]*2)))

        for i in range(num_wedges):
            theta_size = random.uniform(0.03,0.2)+abs(random.gauss(self.values[8]*math.pi/6, .001))
            start_theta = (random.random()*2*math.pi)-(theta_size/2)
            #theta_size = abs(random.gauss(self.values[8]*math.pi/12, self.values[8]*math.pi/12))
            radius = min(self.max_radius - 20, max(random.gauss(self.values[9]*self.max_radius/1.5, self.max_radius/5), 30))
            #elt = Wedge(self.center, self.values[9]*(self.max_radius-20)+3, random.random()*2*math.pi, start_theta + theta_size)
            elt = Wedge(self.center, radius, start_theta, start_theta + theta_size)
            self.elements.append(elt)
        

    def draw(self):
        
        for element in self.elements: 
            element.draw(self.screen)
    
    def to_svg(self, fname): 
        
        dwg = svgwrite.Drawing(fname, self.dimensions)
        for element in self.elements:
            element.to_svg(dwg)
            
        dwg.save()

    def add_element(self, element): 
        self.elements.append(element)

def run_artproof_test(): 
    screen = intialize_pygame((600, 600))
    BACKGROUND_COLOR = (255,255,255)

    # coords = rect_coord_from_center_radius((300, 300), 100)
    # my_slice = Slice((300, 300), 3.14, 3.14+0.7, 100, 200)

    drawing = ArtproofDrawing((600, 600), [0.5, 0.5, 0.5, 0.5, 0.5, 0.5], screen)
    drawing.update(values = [1023/2, 1023/2, 1023/2, 1023/2, 1023/2, 1023/2, 1032/2, 1032/2, 1032/2, 1032/2, 1032/2])

    drawing.to_svg("test.svg")

    while True:
        drawing.draw()
        pygame.display.flip()
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                pygame.quit()

    return drawing

if __name__ == "__main__": 

    drawing = run_artproof_test()

