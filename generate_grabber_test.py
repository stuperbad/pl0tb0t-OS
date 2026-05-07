#!/usr/bin/env python3
"""
Generate an endurance test G-code file that repeatedly picks up and puts down pen 1
using actual tool positions from pl0tb0t_tools.json
"""

import json
import sys

def load_tools(path: str = "pl0tb0t_tools.json"):
    try:
        with open(path, "r") as f:
            data = json.load(f)
            return data.get("tools", [])
    except FileNotFoundError:
        print(f"Error: {path} not found")
        sys.exit(1)

def generate_grabber_test(output_path: str = "test_grabber.gcode", num_cycles: int = 10):
    tools = load_tools()
    
    if not tools:
        print("Error: No tools configured in pl0tb0t_tools.json")
        sys.exit(1)
    
    # Use first tool (pen 1)
    tool = tools[0]
    tool_x = float(tool.get("x", 100))
    tool_y = float(tool.get("y", 100))
    tool_z = float(tool.get("z", 50))
    safe_z = float(tool.get("safe_z", 100))
    tool_y_approach = tool_y + 50  # Approach position (50mm away from clip Y)
    
    fast_feed = 800  # mm/min for moves far from tool
    slow_feed = 50   # mm/min for moves within 10mm of final position
    
    print(f"Generating test for tool: {tool.get('name', 'Tool 1')}")
    print(f"  Position: X={tool_x}, Y={tool_y}, Z={tool_z}, Safe Z={safe_z}")
    print(f"  Approach Y: {tool_y_approach}")
    print(f"  Fast feed: {fast_feed} mm/min, Slow feed: {slow_feed} mm/min")
    print(f"  Cycles: {num_cycles}")
    
    lines = [
        "; Test grabber endurance - pick up and put down pen 1 repeatedly",
        "; Auto-generated from tool positions",
        "; Strategy: fast moves until within 10mm of target, then slow for precision",
        "G90",
        "G21",
        f"; Tool: {tool.get('name', 'Tool 1')} ({tool.get('color', 'unknown')})",
        "",
        "; Initialize - move to safe Z at fast speed",
        f"G0 Z{safe_z} F{fast_feed}",
        "",
    ]
    
    for cycle in range(1, num_cycles + 1):
        lines.append(f"; === Cycle {cycle}/{num_cycles} - PICK UP ===")
        
        # Fast move to X position, still at safe Z
        lines.append(f"; Fast move to tool X (still high)")
        lines.append(f"G0 X{tool_x:.3f} F{fast_feed}")
        
        # Fast move to approach Y
        lines.append(f"; Fast move to approach Y")
        lines.append(f"G0 Y{tool_y_approach:.3f} F{fast_feed}")
        
        # Slow descent to clip Z (within 10mm, so slow feed)
        lines.append(f"; SLOW descent to clip engagement Z")
        lines.append(f"G0 Z{tool_z:.3f} F{slow_feed}")
        lines.append(f"G4 P0.2 ; Pause to let tool seat firmly")
        
        # Slow move inward to clip (within 10mm of final Y, so slow feed)
        lines.append(f"; SLOW clip-in move to final Y position")
        lines.append(f"G0 Y{tool_y:.3f} F{slow_feed}")
        
        # Slow lift out with tool (still near tool, so slow)
        lines.append(f"; SLOW lift out from holder (tool engaged)")
        lines.append(f"G0 Z{safe_z:.3f} F{slow_feed}")
        
        # Fast return to approach position
        lines.append(f"; Fast return to approach Y")
        lines.append(f"G0 Y{tool_y_approach:.3f} F{fast_feed}")
        
        lines.append(f"; === Cycle {cycle}/{num_cycles} - PUT DOWN ===")
        
        # Fast move back to X (no tool, can go fast)
        lines.append(f"; Fast move away on X axis")
        lines.append(f"G0 X{tool_x:.3f} F{fast_feed}")
        
        # Fast return to approach Y
        lines.append(f"; Fast move back to approach Y")
        lines.append(f"G0 Y{tool_y_approach:.3f} F{fast_feed}")
        
        # Slow descent to Z (within 10mm of clip, so slow)
        lines.append(f"; SLOW descent to return to holder")
        lines.append(f"G0 Z{tool_z:.3f} F{slow_feed}")
        
        # Slow move into holder
        lines.append(f"; SLOW move into holder (unclip)")
        lines.append(f"G0 Y{tool_y:.3f} F{slow_feed}")
        
        # Slow lift away from holder
        lines.append(f"; SLOW lift away (release tool)")
        lines.append(f"G0 Z{safe_z:.3f} F{slow_feed}")
        
        # Return to approach Y at fast speed
        lines.append(f"; Fast return to approach")
        lines.append(f"G0 Y{tool_y_approach:.3f} F{fast_feed}")
        
        lines.append(f"G4 P0.1 ; Brief pause between cycles")
        lines.append("")
    
    lines.append("; Done - return to safe Z")
    lines.append(f"G0 Z{safe_z} F{fast_feed}")
    lines.append("M2")
    
    with open(output_path, "w") as f:
        f.write("\n".join(lines))
    
    print(f"\nGenerated: {output_path}")

if __name__ == "__main__":
    num_cycles = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    generate_grabber_test(num_cycles=num_cycles)
