#!/usr/bin/env python3
"""
Pl0tb0t Local Control - Direct terminal UI for CNC plotter
No web overhead, just fast local control + tool management
"""

import os
import sys
import json
import time
from pathlib import Path

# Import from pl0tb0t_OS
from pl0tb0t_OS import (
    load_config, save_config, load_tools, save_tools, Tool,
    open_port, grbl_send, grbl_home, grbl_status, grbl_jog, grbl_move_abs,
    list_serial_ports, find_tool, add_or_update_tool, remove_tool
)

class PlotterControl:
    def __init__(self):
        self.config = load_config()
        self.port = None
        self.tools = load_tools()
        self.machine_pos = {"x": 0.0, "y": 0.0, "z": 0.0}
        self.work_pos = {"x": 0.0, "y": 0.0, "z": 0.0}
        self.work_offset = {"x": 0.0, "y": 0.0, "z": 0.0}

    def clear_screen(self):
        os.system("clear" if os.name != "nt" else "cls")

    def print_header(self, title):
        print("\n" + "=" * 60)
        print(f"  {title}")
        print("=" * 60)

    def print_status(self):
        status = "🟢 CONNECTED" if self.port else "🔴 DISCONNECTED"
        port_str = f" ({self.config.port})" if self.port else ""
        print(f"\n{status}{port_str}")
        print(f"Machine: X={self.machine_pos['x']:.2f} Y={self.machine_pos['y']:.2f} Z={self.machine_pos['z']:.2f}")
        print(f"Work:    X={self.work_pos['x']:.2f} Y={self.work_pos['y']:.2f} Z={self.work_pos['z']:.2f}")

    def update_position(self):
        if not self.port:
            return
        try:
            status = grbl_status(self.port)
            # Parse status like <Idle|MPos:0.000,0.000,0.000|WPos:0.000,0.000,0.000>
            if "|MPos:" in status:
                mpos_str = status.split("|MPos:")[1].split("|")[0]
                x, y, z = map(float, mpos_str.split(","))
                self.machine_pos = {"x": x, "y": y, "z": z}
                self.work_pos = {
                    "x": x - self.work_offset["x"],
                    "y": y - self.work_offset["y"],
                    "z": z - self.work_offset["z"],
                }
        except:
            pass

    def menu_connect(self):
        self.print_header("CONNECT TO PORT")
        ports = list_serial_ports()
        if not ports:
            print("❌ No serial ports found!")
            input("Press Enter...")
            return

        print("\nAvailable ports:")
        for i, (dev, desc) in enumerate(ports, 1):
            marker = "✓" if dev == self.config.port else " "
            print(f"  {marker} {i}. {dev} ({desc})")

        try:
            choice = input("\nSelect port (number): ").strip()
            if choice.isdigit() and 1 <= int(choice) <= len(ports):
                port = ports[int(choice) - 1][0]
                self.port = open_port(port, self.config.baud)
                self.config.port = port
                save_config(self.config)
                self.update_position()
                print(f"✓ Connected to {port}")
        except Exception as e:
            print(f"❌ Error: {e}")
        input("Press Enter...")

    def menu_jog(self):
        self.print_header("JOG MACHINE")
        if not self.port:
            print("❌ Not connected!")
            input("Press Enter...")
            return

        print("\nJog Controls:")
        print("  Arrow keys: X/Y movement")
        print("  U/D: Z movement")
        print("  Q: Quit")
        print("\nEnter axis and distance (e.g., 'x 10' for +10mm X)")
        print("Or use preset: 'u' (up 1mm), 'd' (down 1mm), 'l' (left 1mm), 'r' (right 1mm)")

        while True:
            self.update_position()
            self.print_status()
            cmd = input("\nJog command: ").strip().lower()

            if cmd == "q":
                break
            
            presets = {"u": ("Z", 1), "d": ("Z", -1), "l": ("X", -1), "r": ("X", 1)}
            if cmd in presets:
                axis, dist = presets[cmd]
            else:
                parts = cmd.split()
                if len(parts) != 2:
                    continue
                axis = parts[0].upper()
                try:
                    dist = float(parts[1])
                except:
                    continue

            try:
                grbl_jog(self.port, axis, dist, 500)
                time.sleep(0.5)
            except Exception as e:
                print(f"❌ Error: {e}")

    def menu_tools(self):
        while True:
            self.clear_screen()
            self.print_header("TOOL MANAGEMENT")
            self.print_status()

            print("\nTools:")
            if not self.tools:
                print("  (no tools configured)")
            else:
                for i, tool in enumerate(self.tools, 1):
                    print(f"  {i}. {tool.name} ({tool.color})")
                    print(f"     X={tool.x:.2f} Y={tool.y:.2f} Z={tool.z:.2f} Safe_Z={tool.safe_z:.2f}")

            print("\nOptions:")
            print("  1. Add new tool")
            print("  2. Edit tool")
            print("  3. Move to tool")
            print("  4. Delete tool")
            print("  5. Back")

            choice = input("\nChoice: ").strip()

            if choice == "1":
                self.add_tool_prompt()
            elif choice == "2":
                self.edit_tool_prompt()
            elif choice == "3":
                self.move_to_tool_prompt()
            elif choice == "4":
                self.delete_tool_prompt()
            elif choice == "5":
                break

    def add_tool_prompt(self):
        print("\n--- Add New Tool ---")
        name = input("Tool name: ").strip()
        if not name:
            return

        color = input("Color (optional): ").strip()
        try:
            x = float(input("X position: ") or "0")
            y = float(input("Y position: ") or "0")
            z = float(input("Z position: ") or "0")
            safe_z = float(input("Safe Z (default 50): ") or "50")
        except ValueError:
            print("❌ Invalid input!")
            return

        tool = Tool(name=name, color=color, x=x, y=y, z=z, safe_z=safe_z)
        add_or_update_tool(self.tools, tool)
        save_tools(self.config.tools_path, self.tools)
        print(f"✓ Saved tool '{name}'")
        input("Press Enter...")

    def edit_tool_prompt(self):
        if not self.tools:
            print("No tools to edit!")
            input("Press Enter...")
            return

        print("\nSelect tool to edit:")
        for i, tool in enumerate(self.tools, 1):
            print(f"  {i}. {tool.name}")

        try:
            choice = int(input("Choice: "))
            if 1 <= choice <= len(self.tools):
                tool = self.tools[choice - 1]
                print(f"\nEditing '{tool.name}':")
                name = input(f"Name [{tool.name}]: ").strip() or tool.name
                color = input(f"Color [{tool.color}]: ").strip() or tool.color
                x = float(input(f"X [{tool.x}]: ") or tool.x)
                y = float(input(f"Y [{tool.y}]: ") or tool.y)
                z = float(input(f"Z [{tool.z}]: ") or tool.z)
                safe_z = float(input(f"Safe Z [{tool.safe_z}]: ") or tool.safe_z)

                new_tool = Tool(name=name, color=color, x=x, y=y, z=z, safe_z=safe_z)
                add_or_update_tool(self.tools, new_tool)
                save_tools(self.config.tools_path, self.tools)
                print(f"✓ Updated '{name}'")
        except ValueError:
            print("❌ Invalid input!")
        input("Press Enter...")

    def move_to_tool_prompt(self):
        if not self.port:
            print("❌ Not connected!")
            input("Press Enter...")
            return

        if not self.tools:
            print("No tools configured!")
            input("Press Enter...")
            return

        print("\nSelect tool to move to:")
        for i, tool in enumerate(self.tools, 1):
            print(f"  {i}. {tool.name}")

        try:
            choice = int(input("Choice: "))
            if 1 <= choice <= len(self.tools):
                tool = self.tools[choice - 1]
                print(f"Moving to {tool.name}...")
                if tool.safe_z != tool.z:
                    grbl_move_abs(self.port, tool.x, tool.y, tool.safe_z)
                grbl_move_abs(self.port, tool.x, tool.y, tool.z)
                print("✓ Arrived")
                time.sleep(1)
                self.update_position()
        except ValueError:
            print("❌ Invalid input!")
        input("Press Enter...")

    def delete_tool_prompt(self):
        if not self.tools:
            print("No tools to delete!")
            input("Press Enter...")
            return

        print("\nSelect tool to delete:")
        for i, tool in enumerate(self.tools, 1):
            print(f"  {i}. {tool.name}")

        try:
            choice = int(input("Choice: "))
            if 1 <= choice <= len(self.tools):
                tool = self.tools[choice - 1]
                if input(f"Delete '{tool.name}'? (y/n): ").lower() == "y":
                    remove_tool(self.tools, tool.name)
                    save_tools(self.config.tools_path, self.tools)
                    print(f"✓ Deleted '{tool.name}'")
        except ValueError:
            print("❌ Invalid input!")
        input("Press Enter...")

    def menu_main(self):
        while True:
            self.clear_screen()
            self.print_header("PL0TB0T CONTROL")
            self.print_status()

            print("\nMain Menu:")
            print("  1. Connect to port")
            print("  2. Home machine")
            print("  3. Jog machine")
            print("  4. Manage tools")
            print("  5. Exit")

            choice = input("\nChoice: ").strip()

            if choice == "1":
                self.menu_connect()
            elif choice == "2":
                if self.port:
                    print("\nHoming...")
                    grbl_home(self.port, verbose=True)
                    self.update_position()
                    print("✓ Home complete")
                else:
                    print("❌ Not connected!")
                input("Press Enter...")
            elif choice == "3":
                self.menu_jog()
            elif choice == "4":
                self.menu_tools()
            elif choice == "5":
                if self.port:
                    self.port.close()
                print("Goodbye!")
                break


def main():
    try:
        controller = PlotterControl()
        controller.menu_main()
    except KeyboardInterrupt:
        print("\n\nInterrupted!")
        sys.exit(0)


if __name__ == "__main__":
    main()
