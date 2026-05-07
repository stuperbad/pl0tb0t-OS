#!/usr/bin/env python3
"""
Pl0tb0t Local Control - GUI version with Tkinter (falls back to terminal)
Direct control + tool management with graphical interface
"""

__version__ = "0.3.18"
import os
import time
import re
import threading
import math
import subprocess
from pathlib import Path

# Check if display is available
has_display = os.environ.get("DISPLAY") is not None

if has_display:
    from tkinter import *
    from tkinter import ttk, messagebox, filedialog

# Import from pl0tb0t_OS
from pl0tb0t_OS import (
    load_config, save_config, load_tools, save_tools, Tool,
    open_port, grbl_send, grbl_home, grbl_status, grbl_jog, grbl_move_abs,
    list_serial_ports, find_tool, add_or_update_tool, remove_tool
)


class PlotterGUI:
    def __init__(self, root):
        self.root = root
        self.root.title(f"Pl0tb0t Control v{__version__}")
        self.root.resizable(True, True)

        # Data
        self.config = load_config()
        self.port = None
        self.tools = load_tools(self.config.tools_path)
        self.machine_pos = {"x": 0.0, "y": 0.0, "z": 0.0}
        self.work_pos = {"x": 0.0, "y": 0.0, "z": 0.0}
        self.work_offset = {"x": 0.0, "y": 0.0, "z": 0.0}
        self.jog_dist = 1.0
        self.jog_speed = 500
        # G-code runner / preview state
        self.gcode_path = None
        self.gcode_segments = []
        self.gcode_bounds = None
        self.gcode_preview_truncated = False
        self.gcode_total_lines = 0
        self.gcode_sent_lines = 0
        self.gcode_lines = []
        self.gcode_line_index = 0
        self.gcode_running = False
        self.gcode_paused = False
        self.gcode_stop = False

        # Serial port lock — all serial I/O must hold this to prevent thread races
        self._serial_lock = threading.Lock()

        # Status update loop
        self.running = True
        self.update_thread = threading.Thread(target=self.status_loop, daemon=True)
        self.update_thread.start()

        # Keyboard jog state
        self.jog_keys_held = set()
        self._jog_after_id = None
        self._pending_release = {}  # key -> after_id, for X11 auto-repeat filtering
        self._continuous_jog_active = False
        self.rapid_jog_speed = 3000  # mm/min, updated from GRBL $$ on connect
        self._shift_held = False

        # Build UI
        self.setup_ui()
        self.root.update_idletasks()
        self.root.geometry(f"{self.root.winfo_reqwidth()}x{self.root.winfo_reqheight()}")

    def setup_ui(self):
        # Main container
        main_frame = ttk.Frame(self.root)
        main_frame.pack(fill=BOTH, expand=True, padx=5, pady=5)

        # Top: Status bar
        status_frame = ttk.LabelFrame(main_frame, text="Status", padding=10)
        status_frame.pack(fill=X, pady=(0, 10))

        self.status_label = ttk.Label(status_frame, text="🔴 DISCONNECTED", font=("Arial", 12, "bold"))
        self.status_label.pack(side=LEFT)

        self.port_label = ttk.Label(status_frame, text="Port: None", font=("Arial", 10))
        self.port_label.pack(side=LEFT, padx=20)

        self.version_label = ttk.Label(status_frame, text=f"v{__version__}", font=("Arial", 9))
        self.version_label.pack(side=RIGHT)

        # DRO display
        dro_frame = ttk.Frame(status_frame)
        dro_frame.pack(side=LEFT, padx=20)
        ttk.Label(dro_frame, text="Machine:", font=("Arial", 9, "bold")).pack()
        self.machine_label = ttk.Label(dro_frame, text="X: 0.00  Y: 0.00  Z: 0.00", font=("Courier", 9))
        self.machine_label.pack()

        work_dro = ttk.Frame(status_frame)
        work_dro.pack(side=LEFT, padx=20)
        ttk.Label(work_dro, text="Work (G54):", font=("Arial", 9, "bold")).pack()
        self.work_label = ttk.Label(work_dro, text="X: 0.00  Y: 0.00  Z: 0.00", font=("Courier", 9))
        self.work_label.pack()

        # WCS selector
        wcs_frame = ttk.Frame(status_frame)
        wcs_frame.pack(side=LEFT, padx=20)
        ttk.Label(wcs_frame, text="Work Offset:", font=("Arial", 9, "bold")).pack()
        self.wcs_var = StringVar(value="G54")
        self.wcs_combo = ttk.Combobox(wcs_frame, textvariable=self.wcs_var, 
                                       values=["G54", "G55", "G56", "G57", "G58", "G59"], 
                                       width=8, state="readonly")
        self.wcs_combo.pack()
        self.wcs_combo.bind("<<ComboboxSelected>>", self.on_wcs_change)

        # Main content: Left (Control), Center (Test Pen Generator), Right (Tools)
        content = ttk.Frame(main_frame)
        content.pack(fill=BOTH, expand=True)

        # LEFT: Connection and Jog Controls
        left = ttk.LabelFrame(content, text="Machine Control", padding=10)
        left.pack(side=LEFT, fill=BOTH, expand=False, padx=(0, 10))

        # Connection section
        conn_frame = ttk.LabelFrame(left, text="Connection", padding=10)
        conn_frame.pack(fill=X, pady=(0, 10))

        ttk.Label(conn_frame, text="Port:").pack(side=LEFT)
        self.port_var = StringVar(value=self.config.port or "")
        self.port_combo = ttk.Combobox(conn_frame, textvariable=self.port_var, width=15, state="readonly")
        self.port_combo.pack(side=LEFT, padx=5)
        self.refresh_ports()

        ttk.Button(conn_frame, text="Refresh", command=self.refresh_ports).pack(side=LEFT, padx=2)
        ttk.Button(conn_frame, text="Connect", command=self.connect_port).pack(side=LEFT, padx=2)
        ttk.Button(conn_frame, text="Disconnect", command=self.disconnect_port).pack(side=LEFT, padx=2)

        conn_actions = ttk.Frame(conn_frame)
        conn_actions.pack(fill=X, pady=(6, 0))
        ttk.Button(conn_actions, text="🏠 Home", command=self.home_machine).pack(side=LEFT, padx=(0, 4))
        ttk.Button(conn_actions, text="🔓 Unlock", command=self.unlock_machine).pack(side=LEFT)

        # Jog section
        jog_frame = ttk.LabelFrame(left, text="Jogging", padding=10)
        jog_frame.pack(fill=X, pady=(0, 10))
        
        # Jogging mode info
        info_label = ttk.Label(jog_frame, text="Tap = step  |  Hold (0.35s) = continuous  |  Shift = rapid",
                               foreground="blue", font=("Arial", 8, "italic"))
        info_label.pack(pady=(0, 5))

        ttk.Label(jog_frame, text="Distance (mm):").pack()
        self.jog_dist_var = DoubleVar(value=1.0)
        self.jog_dist_scale = ttk.Scale(jog_frame, from_=0.1, to=50, orient=HORIZONTAL, 
                                         variable=self.jog_dist_var, command=self.update_jog_label)
        self.jog_dist_scale.pack(fill=X)
        self.jog_dist_label = ttk.Label(jog_frame, text="1.0 mm")
        self.jog_dist_label.pack()

        ttk.Label(jog_frame, text="Speed (mm/min):").pack(pady=(10, 0))
        self.jog_speed_var = IntVar(value=500)
        self.jog_speed_scale = ttk.Scale(jog_frame, from_=10, to=2000, orient=HORIZONTAL,
                                          variable=self.jog_speed_var, command=self.update_speed_label)
        self.jog_speed_scale.pack(fill=X)
        self.jog_speed_label = ttk.Label(jog_frame, text="500 mm/min")
        self.jog_speed_label.pack()

        # Jog buttons - 3x3 grid for X/Y
        buttons_frame = ttk.Frame(jog_frame)
        buttons_frame.pack(pady=10)

        ttk.Button(buttons_frame, text="↑↑↑ +Y", command=lambda: self.jog_axis("Y", self.jog_dist_var.get())).grid(row=0, column=1, padx=2, pady=2)

        ttk.Button(buttons_frame, text="← -X", command=lambda: self.jog_axis("X", -self.jog_dist_var.get())).grid(row=1, column=0, padx=2, pady=2)
        center_btn = ttk.Button(buttons_frame, text="CENTER", command=self.jog_zero)
        center_btn.grid(row=1, column=1, padx=2, pady=2)
        self.create_tooltip(center_btn, "Set work offset to current position")
        ttk.Button(buttons_frame, text="+X →", command=lambda: self.jog_axis("X", self.jog_dist_var.get())).grid(row=1, column=2, padx=2, pady=2)

        ttk.Button(buttons_frame, text="↓↓↓ -Y", command=lambda: self.jog_axis("Y", -self.jog_dist_var.get())).grid(row=2, column=1, padx=2, pady=2)

        # Z buttons
        z_frame = ttk.Frame(jog_frame)
        z_frame.pack(fill=X, pady=10)
        ttk.Button(z_frame, text="↑ +Z", command=lambda: self.jog_axis("Z", self.jog_dist_var.get()), width=10).pack(side=LEFT, padx=2)
        ttk.Button(z_frame, text="↓ -Z", command=lambda: self.jog_axis("Z", -self.jog_dist_var.get()), width=10).pack(side=LEFT, padx=2)

        # Pen quick buttons
        pen_frame = ttk.LabelFrame(left, text="Pen Shortcuts", padding=10)
        pen_frame.pack(fill=X, pady=(0, 10))
        
        self.pen_buttons_frame = ttk.Frame(pen_frame)
        self.pen_buttons_frame.pack(fill=X)
        self.refresh_pen_buttons()

        # Work zeroing
        workzero_frame = ttk.LabelFrame(left, text="Work Zero", padding=10)
        workzero_frame.pack(fill=X, pady=(0, 10))

        wcs_row = ttk.Frame(workzero_frame)
        wcs_row.pack(fill=X)
        ttk.Label(wcs_row, text="Active WCS:").pack(side=LEFT)
        ttk.Label(wcs_row, textvariable=self.wcs_var, font=("Arial", 9, "bold")).pack(side=LEFT, padx=6)

        zero_row = ttk.Frame(workzero_frame)
        zero_row.pack(fill=X, pady=(6, 0))
        ttk.Button(zero_row, text="Zero X", command=lambda: self.zero_wcs_axis("X")).pack(side=LEFT, padx=2)
        ttk.Button(zero_row, text="Zero Y", command=lambda: self.zero_wcs_axis("Y")).pack(side=LEFT, padx=2)
        ttk.Button(zero_row, text="Zero Z", command=lambda: self.zero_wcs_axis("Z")).pack(side=LEFT, padx=2)
        ttk.Button(zero_row, text="Zero All", command=self.zero_wcs_all).pack(side=LEFT, padx=2)

        # Bind keyboard events for continuous jog
        self.root.bind("<KeyPress>", self.on_key_press)
        self.root.bind("<KeyRelease>", self.on_key_release)

        # CENTER column: Test Pen Generator + vpype G-code Generator
        center = ttk.Frame(content)
        center.pack(side=LEFT, fill=Y, expand=False, padx=(0, 10))

        testpen_frame = self._make_labeled_frame(center, "Test Pen File Generator",
            "Generates a G-code file to cycle through pen pickups and drops.\n"
            "Use this to verify tool-change positions before a real plot.\n"
            "Configure pen count, cycle count, speeds, and offsets, then\n"
            "click Generate to save the file and load it in the G-code runner.", padding=10)
        testpen_frame.pack(fill=X, pady=(0, 10))

        # Pen count
        ttk.Label(testpen_frame, text="Number of pens to cycle:").grid(row=0, column=0, sticky=W)
        self.testpen_count_var = IntVar(value=3)
        ttk.Entry(testpen_frame, textvariable=self.testpen_count_var, width=5).grid(row=0, column=1, sticky=W)

        # Cycles
        ttk.Label(testpen_frame, text="Number of cycles:").grid(row=1, column=0, sticky=W)
        self.testpen_cycles_var = IntVar(value=5)
        ttk.Entry(testpen_frame, textvariable=self.testpen_cycles_var, width=5).grid(row=1, column=1, sticky=W)

        # Rapid speed
        ttk.Label(testpen_frame, text="Rapid speed (mm/min):").grid(row=2, column=0, sticky=W)
        self.testpen_rapid_var = IntVar(value=800)
        ttk.Entry(testpen_frame, textvariable=self.testpen_rapid_var, width=7).grid(row=2, column=1, sticky=W)

        # Approach speed
        ttk.Label(testpen_frame, text="Approach speed (mm/min):").grid(row=3, column=0, sticky=W)
        self.testpen_approach_var = IntVar(value=50)
        ttk.Entry(testpen_frame, textvariable=self.testpen_approach_var, width=7).grid(row=3, column=1, sticky=W)

        # Overshoot
        ttk.Label(testpen_frame, text="Overshoot (mm):").grid(row=4, column=0, sticky=W)
        self.testpen_overshoot_var = DoubleVar(value=0.03)
        ttk.Entry(testpen_frame, textvariable=self.testpen_overshoot_var, width=7).grid(row=4, column=1, sticky=W)

        # Unplug offset
        ttk.Label(testpen_frame, text="Unplug offset (mm):").grid(row=5, column=0, sticky=W)
        self.testpen_unplug_offset_var = DoubleVar(value=20.0)
        ttk.Entry(testpen_frame, textvariable=self.testpen_unplug_offset_var, width=7).grid(row=5, column=1, sticky=W)

        # Lift offset
        ttk.Label(testpen_frame, text="Lift offset (mm):").grid(row=6, column=0, sticky=W)
        self.testpen_lift_offset_var = DoubleVar(value=50.0)
        ttk.Entry(testpen_frame, textvariable=self.testpen_lift_offset_var, width=7).grid(row=6, column=1, sticky=W)

        # Generate button
        ttk.Button(testpen_frame, text="Generate Test G-code", command=self.generate_testpen_gcode).grid(row=7, column=0, columnspan=2, pady=10)

        # vpype G-code Generator (center column, below test pen)
        vpype_frame = ttk.LabelFrame(center, text="vpype G-code Generator", padding=10)
        vpype_frame.pack(fill=X)

        self.vpype_svg_var = StringVar(value="")
        self.vpype_config_var = StringVar(value="pl0tb0t_vpype_pentest_gcode.toml")
        self.vpype_profile_var = StringVar(value="")
        self.vpype_output_var = StringVar(value="")
        self.vpype_linemerge_var = BooleanVar(value=True)
        self.vpype_linesort_var = BooleanVar(value=True)
        self.vpype_reloop_var = BooleanVar(value=False)
        self.vpype_linesimplify_var = BooleanVar(value=True)
        self.vpype_simplify_tol_var = DoubleVar(value=0.05)

        svg_row = ttk.Frame(vpype_frame)
        svg_row.pack(fill=X, pady=(0, 4))
        ttk.Label(svg_row, text="SVG:").pack(side=LEFT)
        ttk.Entry(svg_row, textvariable=self.vpype_svg_var).pack(side=LEFT, fill=X, expand=True, padx=6)
        ttk.Button(svg_row, text="Browse", command=self.browse_vpype_svg).pack(side=LEFT)

        cfg_row = ttk.Frame(vpype_frame)
        cfg_row.pack(fill=X, pady=(0, 4))
        ttk.Label(cfg_row, text="Config:").pack(side=LEFT)
        ttk.Entry(cfg_row, textvariable=self.vpype_config_var).pack(side=LEFT, fill=X, expand=True, padx=6)
        ttk.Button(cfg_row, text="Browse", command=self.browse_vpype_config).pack(side=LEFT)

        profile_row = ttk.Frame(vpype_frame)
        profile_row.pack(fill=X, pady=(0, 4))
        ttk.Label(profile_row, text="Profile:").pack(side=LEFT)
        ttk.Entry(profile_row, textvariable=self.vpype_profile_var).pack(side=LEFT, fill=X, expand=True, padx=6)

        out_row = ttk.Frame(vpype_frame)
        out_row.pack(fill=X, pady=(0, 4))
        ttk.Label(out_row, text="Output:").pack(side=LEFT)
        ttk.Entry(out_row, textvariable=self.vpype_output_var).pack(side=LEFT, fill=X, expand=True, padx=6)
        ttk.Button(out_row, text="Browse", command=self.browse_vpype_output).pack(side=LEFT)

        opt_row = ttk.Frame(vpype_frame)
        opt_row.pack(fill=X, pady=(0, 4))
        ttk.Checkbutton(opt_row, text="linemerge", variable=self.vpype_linemerge_var).pack(side=LEFT, padx=(0, 8))
        ttk.Checkbutton(opt_row, text="linesort", variable=self.vpype_linesort_var).pack(side=LEFT, padx=(0, 8))
        ttk.Checkbutton(opt_row, text="reloop", variable=self.vpype_reloop_var).pack(side=LEFT, padx=(0, 8))

        simplify_row = ttk.Frame(vpype_frame)
        simplify_row.pack(fill=X)
        ttk.Checkbutton(simplify_row, text="linesimplify", variable=self.vpype_linesimplify_var).pack(side=LEFT)
        ttk.Label(simplify_row, text="tol (mm):").pack(side=LEFT, padx=(6, 2))
        ttk.Entry(simplify_row, textvariable=self.vpype_simplify_tol_var, width=6).pack(side=LEFT)
        ttk.Button(simplify_row, text="Generate via vpype", command=self.run_vpype).pack(side=RIGHT)

        # RIGHT: Tool Management
        right = self._make_labeled_frame(content, "Tool Management",
            "Define and calibrate tool positions for the dove-tail tool changer.\n"
            "Each tool stores its X/Y pickup location and Z depth.\n"
            "Safe Z is the clearance height used when travelling to the tool.\n"
            "Use 'Go To' to jog the machine to a tool's saved position.", padding=10)
        right.pack(side=LEFT, fill=BOTH, expand=True)

        # Tool list
        list_frame = ttk.Frame(right)
        list_frame.pack(fill=BOTH, expand=True, pady=(0, 10))

        ttk.Label(list_frame, text="Tools:", font=("Arial", 10, "bold")).pack(anchor=W)

        scrollbar = ttk.Scrollbar(list_frame)
        scrollbar.pack(side=RIGHT, fill=Y)

        self.tools_listbox = Listbox(list_frame, yscrollcommand=scrollbar.set, font=("Courier", 9), height=12)
        self.tools_listbox.pack(fill=BOTH, expand=True)
        scrollbar.config(command=self.tools_listbox.yview)
        self.tools_listbox.bind("<<ListboxSelect>>", self.on_tool_select)

        self.refresh_tool_list()

        # Tool edit section
        edit_frame = ttk.LabelFrame(right, text="Edit Tool", padding=10)
        edit_frame.pack(fill=X)

        ttk.Label(edit_frame, text="Name:").grid(row=0, column=0, sticky=W)
        self.tool_name_var = StringVar()
        ttk.Entry(edit_frame, textvariable=self.tool_name_var, width=20).grid(row=0, column=1, sticky=EW, padx=5)

        ttk.Label(edit_frame, text="Color:").grid(row=0, column=2, sticky=W)
        self.tool_color_var = StringVar()
        ttk.Entry(edit_frame, textvariable=self.tool_color_var, width=15).grid(row=0, column=3, sticky=EW, padx=5)

        ttk.Label(edit_frame, text="X:").grid(row=1, column=0, sticky=W)
        self.tool_x_var = DoubleVar()
        ttk.Entry(edit_frame, textvariable=self.tool_x_var, width=12).grid(row=1, column=1, sticky=EW, padx=5)

        ttk.Label(edit_frame, text="Y:").grid(row=1, column=2, sticky=W)
        self.tool_y_var = DoubleVar()
        ttk.Entry(edit_frame, textvariable=self.tool_y_var, width=12).grid(row=1, column=3, sticky=EW, padx=5)

        ttk.Label(edit_frame, text="Z:").grid(row=2, column=0, sticky=W)
        self.tool_z_var = DoubleVar()
        ttk.Entry(edit_frame, textvariable=self.tool_z_var, width=12).grid(row=2, column=1, sticky=EW, padx=5)

        ttk.Label(edit_frame, text="Safe Z:").grid(row=2, column=2, sticky=W)
        self.tool_safe_z_var = DoubleVar(value=50)
        ttk.Entry(edit_frame, textvariable=self.tool_safe_z_var, width=12).grid(row=2, column=3, sticky=EW, padx=5)

        edit_frame.columnconfigure(1, weight=1)
        edit_frame.columnconfigure(3, weight=1)

        # Tool buttons
        button_frame = ttk.Frame(right)
        button_frame.pack(fill=X, pady=10)

        ttk.Button(button_frame, text="➕ Add Tool", command=self.add_tool).pack(side=LEFT, padx=2)
        ttk.Button(button_frame, text="💾 Save", command=self.save_tool).pack(side=LEFT, padx=2)
        ttk.Button(button_frame, text="🎯 Go To", command=self.go_to_tool).pack(side=LEFT, padx=2)
        ttk.Button(button_frame, text="🗑️ Delete", command=self.delete_tool).pack(side=LEFT, padx=2)
        ttk.Button(button_frame, text="🔄 Refresh", command=self.refresh_tool_list).pack(side=LEFT, padx=2)
        ttk.Button(button_frame, text="📤 Export TOML", command=self.export_toml).pack(side=LEFT, padx=2)

        # G-code Runner + Preview (local only)
        gcode_frame = ttk.LabelFrame(right, text="G-code Runner + Preview", padding=10)
        gcode_frame.pack(fill=BOTH, expand=True, pady=(10, 0))

        file_row = ttk.Frame(gcode_frame)
        file_row.pack(fill=X)
        ttk.Label(file_row, text="File:").pack(side=LEFT)
        self.gcode_path_var = StringVar(value="")
        self.gcode_entry = ttk.Entry(file_row, textvariable=self.gcode_path_var)
        self.gcode_entry.pack(side=LEFT, fill=X, expand=True, padx=6)
        ttk.Button(file_row, text="Browse", command=self.browse_gcode_file).pack(side=LEFT)

        opts_row = ttk.Frame(gcode_frame)
        opts_row.pack(fill=X, pady=(6, 0))
        self.gcode_home_first_var = BooleanVar(value=False)
        ttk.Checkbutton(opts_row, text="Home before run", variable=self.gcode_home_first_var).pack(side=LEFT)

        btn_row = ttk.Frame(gcode_frame)
        btn_row.pack(fill=X, pady=(6, 0))
        self.gcode_run_btn = ttk.Button(btn_row, text="▶ Run", command=self.run_gcode)
        self.gcode_run_btn.pack(side=LEFT, padx=(0, 6))
        self.gcode_pause_btn = ttk.Button(btn_row, text="⏸ Pause", command=self.toggle_pause_gcode, state=DISABLED)
        self.gcode_pause_btn.pack(side=LEFT, padx=(0, 6))
        self.gcode_stop_btn = ttk.Button(btn_row, text="⏹ Stop", command=self.stop_gcode, state=DISABLED)
        self.gcode_stop_btn.pack(side=LEFT)

        self.gcode_status_var = StringVar(value="No file loaded")
        ttk.Label(gcode_frame, textvariable=self.gcode_status_var).pack(anchor=W, pady=(6, 0))

        self.gcode_progress = ttk.Progressbar(gcode_frame, mode="determinate")
        self.gcode_progress.pack(fill=X, pady=(4, 6))

        preview_frame = ttk.Frame(gcode_frame)
        preview_frame.pack(fill=BOTH, expand=True)
        self.preview_canvas = Canvas(preview_frame, height=260, background="white")
        self.preview_canvas.pack(fill=BOTH, expand=True)
        self.preview_canvas.bind("<Configure>", lambda e: self.draw_gcode_preview())

        viewer_frame = ttk.LabelFrame(gcode_frame, text="G-code Viewer", padding=6)
        viewer_frame.pack(fill=BOTH, expand=False, pady=(6, 0))
        viewer_list_frame = ttk.Frame(viewer_frame)
        viewer_list_frame.pack(fill=BOTH, expand=True)
        viewer_scroll = ttk.Scrollbar(viewer_list_frame)
        viewer_scroll.pack(side=RIGHT, fill=Y)
        self.gcode_listbox = Listbox(viewer_list_frame, yscrollcommand=viewer_scroll.set, font=("Courier", 8), height=8)
        self.gcode_listbox.pack(fill=BOTH, expand=True)
        viewer_scroll.config(command=self.gcode_listbox.yview)

        viewer_btns = ttk.Frame(viewer_frame)
        viewer_btns.pack(fill=X, pady=(4, 0))
        ttk.Button(viewer_btns, text="Send Selected Line", command=self.send_selected_gcode_line).pack(side=LEFT)
        ttk.Button(viewer_btns, text="Send Next Line", command=self.send_next_gcode_line).pack(side=LEFT, padx=6)
        ttk.Button(viewer_btns, text="Reset Line Index", command=self.reset_gcode_line_index).pack(side=LEFT)

    def export_toml(self):
        try:
            from toml import dumps as toml_dumps
        except ImportError:
            messagebox.showerror("Error", "toml module not installed. Run: pip install toml")
            return
        # Ask for file path
        file_path = filedialog.asksaveasfilename(
            defaultextension=".toml",
            filetypes=[("TOML files", "*.toml"), ("All files", "*.*")],
            initialfile="pl0tb0t_tools_export.toml"
        )
        if not file_path:
            return
        # Build TOML dict
        data = {"tools": [
            {"name": t.name, "color": t.color, "x": t.x, "y": t.y, "z": t.z, "safe_z": t.safe_z}
            for t in self.tools
        ]}
        with open(file_path, "w") as f:
            f.write(toml_dumps(data))
        messagebox.showinfo("Exported", f"Exported to {file_path}")

    def browse_gcode_file(self):
        file_path = filedialog.askopenfilename(
            filetypes=[("G-code files", "*.gcode *.gc *.nc *.tap"), ("All files", "*.*")]
        )
        if not file_path:
            return
        self.load_gcode_file(file_path)

    def browse_vpype_svg(self):
        file_path = filedialog.askopenfilename(
            filetypes=[("SVG files", "*.svg"), ("All files", "*.*")]
        )
        if not file_path:
            return
        self.vpype_svg_var.set(file_path)
        if not self.vpype_output_var.get():
            base = os.path.splitext(file_path)[0]
            self.vpype_output_var.set(base + "_vpype.gcode")

    def browse_vpype_config(self):
        file_path = filedialog.askopenfilename(
            filetypes=[("TOML files", "*.toml"), ("All files", "*.*")]
        )
        if not file_path:
            return
        self.vpype_config_var.set(file_path)
        if not self.vpype_profile_var.get():
            self.vpype_profile_var.set(Path(file_path).stem)

    def browse_vpype_output(self):
        file_path = filedialog.asksaveasfilename(
            defaultextension=".gcode",
            filetypes=[("G-code files", "*.gcode"), ("All files", "*.*")]
        )
        if not file_path:
            return
        self.vpype_output_var.set(file_path)

    def load_gcode_file(self, file_path: str):
        self.gcode_path = file_path
        self.gcode_path_var.set(file_path)
        self._load_gcode_lines(file_path)
        self.parse_gcode_for_preview(file_path)
        self.draw_gcode_preview()
        self.refresh_gcode_viewer()

    def _clean_gcode_line(self, line: str) -> str:
        line = line.strip()
        if not line:
            return ""
        line = re.sub(r"\(.*?\)", "", line)
        if line.lstrip().startswith(";"):
            return ""
        if ";" in line:
            line = line.split(";", 1)[0]
        return line.strip().upper()

    def run_vpype(self):
        svg_path = self.vpype_svg_var.get().strip()
        config_path = self.vpype_config_var.get().strip()
        output_path = self.vpype_output_var.get().strip()
        if not svg_path:
            messagebox.showerror("Error", "Select an SVG file first")
            return
        if not os.path.exists(svg_path):
            messagebox.showerror("Error", "SVG file not found")
            return
        if not config_path:
            messagebox.showerror("Error", "Select a vpype config file")
            return
        if not os.path.exists(config_path):
            messagebox.showerror("Error", "vpype config file not found")
            return
        if not output_path:
            base = os.path.splitext(svg_path)[0]
            output_path = base + "_vpype.gcode"
            self.vpype_output_var.set(output_path)

        steps = ["read", svg_path]
        if self.vpype_linemerge_var.get():
            steps.append("linemerge")
        if self.vpype_linesort_var.get():
            steps.append("linesort")
        if self.vpype_reloop_var.get():
            steps.append("reloop")
        if self.vpype_linesimplify_var.get():
            tol = float(self.vpype_simplify_tol_var.get())
            steps.extend(["linesimplify", "-t", f"{tol}mm"])

        cmd = ["vpype", "-c", config_path, *steps, "gwrite"]
        profile = self.vpype_profile_var.get().strip()
        if profile:
            cmd.extend(["-p", profile])
        cmd.append(output_path)
        try:
            result = subprocess.run(cmd, capture_output=True, text=True)
        except FileNotFoundError:
            messagebox.showerror("Error", "vpype not found. Install it and make sure it's on PATH.")
            return

        if result.returncode != 0:
            stderr = result.stderr.strip() or "vpype failed"
            messagebox.showerror("vpype Error", stderr)
            return

        self.load_gcode_file(output_path)
        messagebox.showinfo("Success", f"G-code saved to {output_path}")

    def _load_gcode_lines(self, file_path: str):
        self.gcode_lines = []
        self.gcode_line_index = 0
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                for raw_line in f:
                    clean = self._clean_gcode_line(raw_line)
                    if clean:
                        self.gcode_lines.append(clean)
        except Exception:
            self.gcode_lines = []

    def refresh_gcode_viewer(self):
        if not hasattr(self, "gcode_listbox"):
            return
        self.gcode_listbox.delete(0, END)
        if not self.gcode_lines:
            self.gcode_listbox.insert(END, "(no executable gcode lines)")
            return
        for i, line in enumerate(self.gcode_lines):
            self.gcode_listbox.insert(END, f"{i+1:04d}: {line}")
        self._highlight_gcode_line()

    def _highlight_gcode_line(self):
        if not self.gcode_lines:
            return
        idx = min(self.gcode_line_index, len(self.gcode_lines) - 1)
        self.gcode_listbox.selection_clear(0, END)
        self.gcode_listbox.selection_set(idx)
        self.gcode_listbox.see(idx)

    def reset_gcode_line_index(self):
        self.gcode_line_index = 0
        self._highlight_gcode_line()

    def send_selected_gcode_line(self):
        if self.gcode_running:
            messagebox.showwarning("Warning", "Stop the current run before sending manual lines")
            return
        if not self.port:
            messagebox.showerror("Error", "Not connected!")
            return
        selection = self.gcode_listbox.curselection()
        if not selection:
            messagebox.showwarning("Warning", "Select a line first")
            return
        idx = selection[0]
        if idx >= len(self.gcode_lines):
            return
        line = self.gcode_lines[idx]
        try:
            with self._serial_lock:
                grbl_send(self.port, line, wait_ok=True, verbose=False)
            self.gcode_line_index = min(idx + 1, len(self.gcode_lines) - 1)
            self._highlight_gcode_line()
            self.gcode_status_var.set(f"Sent line {idx+1}")
        except Exception as e:
            messagebox.showerror("G-code Error", str(e))

    def send_next_gcode_line(self):
        if self.gcode_running:
            messagebox.showwarning("Warning", "Stop the current run before sending manual lines")
            return
        if not self.port:
            messagebox.showerror("Error", "Not connected!")
            return
        if not self.gcode_lines:
            messagebox.showwarning("Warning", "Load a G-code file first")
            return
        idx = min(self.gcode_line_index, len(self.gcode_lines) - 1)
        line = self.gcode_lines[idx]
        try:
            with self._serial_lock:
                grbl_send(self.port, line, wait_ok=True, verbose=False)
            self.gcode_line_index = min(idx + 1, len(self.gcode_lines) - 1)
            self._highlight_gcode_line()
            self.gcode_status_var.set(f"Sent line {idx+1}")
        except Exception as e:
            messagebox.showerror("G-code Error", str(e))

    def parse_gcode_for_preview(self, file_path: str):
        segments = []
        bounds = None
        truncated = False
        max_segments = 10000

        x = 0.0
        y = 0.0
        abs_mode = True
        motion_mode = "G0"
        total_lines = 0

        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                for raw_line in f:
                    clean = self._clean_gcode_line(raw_line)
                    if not clean:
                        continue
                    total_lines += 1
                    words = re.findall(r"([A-Z])\s*([-+]?\d*\.?\d+)", clean)
                    if not words:
                        continue

                    g_codes = [int(float(val)) for letter, val in words if letter == "G"]
                    if 90 in g_codes:
                        abs_mode = True
                    if 91 in g_codes:
                        abs_mode = False
                    if 0 in g_codes:
                        motion_mode = "G0"
                    if 1 in g_codes:
                        motion_mode = "G1"

                    x_val = None
                    y_val = None
                    for letter, val in words:
                        if letter == "X":
                            x_val = float(val)
                        elif letter == "Y":
                            y_val = float(val)

                    if x_val is None and y_val is None:
                        continue

                    new_x = x + x_val if (x_val is not None and not abs_mode) else (x_val if x_val is not None else x)
                    new_y = y + y_val if (y_val is not None and not abs_mode) else (y_val if y_val is not None else y)

                    if new_x != x or new_y != y:
                        if bounds is None:
                            bounds = [x, y, x, y]
                        bounds[0] = min(bounds[0], x, new_x)
                        bounds[1] = min(bounds[1], y, new_y)
                        bounds[2] = max(bounds[2], x, new_x)
                        bounds[3] = max(bounds[3], y, new_y)

                        if len(segments) < max_segments:
                            segments.append((x, y, new_x, new_y, motion_mode))
                        else:
                            truncated = True

                        x = new_x
                        y = new_y

            self.gcode_segments = segments
            self.gcode_bounds = bounds
            self.gcode_preview_truncated = truncated
            self.gcode_total_lines = total_lines
            if bounds:
                w = bounds[2] - bounds[0]
                h = bounds[3] - bounds[1]
                extra = " (preview truncated)" if truncated else ""
                self.gcode_status_var.set(f"Loaded: {Path(file_path).name}  |  Bounds {w:.2f} x {h:.2f} mm{extra}")
            else:
                self.gcode_status_var.set(f"Loaded: {Path(file_path).name}  |  No XY moves found")
        except Exception as e:
            self.gcode_segments = []
            self.gcode_bounds = None
            self.gcode_preview_truncated = False
            self.gcode_total_lines = 0
            self.gcode_status_var.set(f"Failed to load: {e}")

    def draw_gcode_preview(self):
        canvas = self.preview_canvas
        canvas.delete("all")
        if not self.gcode_segments or not self.gcode_bounds:
            canvas.create_text(10, 10, anchor="nw", text="No preview available", fill="gray")
            return

        width = max(canvas.winfo_width(), 1)
        height = max(canvas.winfo_height(), 1)
        pad = 10
        min_x, min_y, max_x, max_y = self.gcode_bounds
        span_x = max(max_x - min_x, 1e-6)
        span_y = max(max_y - min_y, 1e-6)
        scale = min((width - 2 * pad) / span_x, (height - 2 * pad) / span_y)

        def map_point(px, py):
            cx = pad + (px - min_x) * scale
            cy = height - pad - (py - min_y) * scale
            return cx, cy

        for x0, y0, x1, y1, mode in self.gcode_segments:
            sx0, sy0 = map_point(x0, y0)
            sx1, sy1 = map_point(x1, y1)
            color = "#cccccc" if mode == "G0" else "#222222"
            canvas.create_line(sx0, sy0, sx1, sy1, fill=color)

    def run_gcode(self):
        if not self.port:
            messagebox.showerror("Error", "Not connected!")
            return
        if not self.gcode_path:
            messagebox.showerror("Error", "Load a G-code file first")
            return
        if self.gcode_running:
            messagebox.showwarning("Warning", "G-code already running")
            return

        self.gcode_running = True
        self.gcode_paused = False
        self.gcode_stop = False
        self.gcode_sent_lines = 0
        self.gcode_progress["value"] = 0
        self.gcode_run_btn.config(state=DISABLED)
        self.gcode_pause_btn.config(state=NORMAL, text="⏸ Pause")
        self.gcode_stop_btn.config(state=NORMAL)

        def runner():
            try:
                if self.gcode_home_first_var.get():
                    grbl_home(self.port, verbose=False)
                    time.sleep(0.5)

                total = self.gcode_total_lines
                if total <= 0:
                    # Recount if preview failed
                    with open(self.gcode_path, "r", encoding="utf-8", errors="ignore") as f:
                        total = sum(1 for line in f if self._clean_gcode_line(line))
                    self.gcode_total_lines = total

                with open(self.gcode_path, "r", encoding="utf-8", errors="ignore") as f:
                    for raw_line in f:
                        if self.gcode_stop:
                            break
                        while self.gcode_paused and not self.gcode_stop:
                            time.sleep(0.1)

                        line = self._clean_gcode_line(raw_line)
                        if not line:
                            continue

                        with self._serial_lock:
                            grbl_send(self.port, line, wait_ok=True, verbose=False)
                        self.gcode_sent_lines += 1
                        if total > 0:
                            pct = (self.gcode_sent_lines / total) * 100.0
                            self.root.after(0, lambda v=pct: self.gcode_progress.config(value=v))
            except Exception as e:
                self.root.after(0, lambda: messagebox.showerror("G-code Error", str(e)))
            finally:
                self.gcode_running = False
                self.gcode_paused = False
                self.gcode_stop = False
                self.root.after(0, self._reset_gcode_buttons)

        threading.Thread(target=runner, daemon=True).start()

    def _reset_gcode_buttons(self):
        self.gcode_run_btn.config(state=NORMAL)
        self.gcode_pause_btn.config(state=DISABLED, text="⏸ Pause")
        self.gcode_stop_btn.config(state=DISABLED)

    def toggle_pause_gcode(self):
        if not self.gcode_running:
            return
        self.gcode_paused = not self.gcode_paused
        if self.port:
            try:
                if self.gcode_paused:
                    with self._serial_lock:
                        self.port.write(b"!")
                    self.gcode_pause_btn.config(text="▶ Resume")
                else:
                    with self._serial_lock:
                        self.port.write(b"~")
                    self.gcode_pause_btn.config(text="⏸ Pause")
            except Exception:
                pass

    def stop_gcode(self):
        if not self.gcode_running:
            return
        self.gcode_stop = True
        self.gcode_paused = False

    def generate_testpen_gcode(self):
        try:
            pen_count = int(self.testpen_count_var.get())
            cycles = int(self.testpen_cycles_var.get())
            rapid = int(self.testpen_rapid_var.get())
            approach = int(self.testpen_approach_var.get())
            overshoot = float(self.testpen_overshoot_var.get())
            unplug_offset = float(self.testpen_unplug_offset_var.get())
            lift_offset = float(self.testpen_lift_offset_var.get())
        except Exception:
            messagebox.showerror("Error", "Pen count, cycles, and speeds must be numeric")
            return

        if pen_count < 1 or cycles < 1:
            messagebox.showerror("Error", "Pen count and cycles must be > 0")
            return
        # Reload tools in case they were edited outside the running GUI.
        self.tools = load_tools(self.config.tools_path)
        if pen_count > len(self.tools):
            messagebox.showerror("Error", f"Not enough tools defined (have {len(self.tools)})")
            return
        tools = self.tools[:pen_count]

        file_path = filedialog.asksaveasfilename(
            defaultextension=".gcode",
            filetypes=[("G-code files", "*.gcode"), ("All files", "*.*")],
            initialfile="test_pen_cycle.gcode"
        )
        if not file_path:
            return

        lines = []
        lines.append(f"; Test pen cycle: {pen_count} pens, {cycles} cycles, rapid {rapid}, approach {approach}, overshoot {overshoot}")
        lines.append(f"; Unplug offset: {unplug_offset}, lift offset: {lift_offset}")
        lines.append("G21 ; mm mode")
        lines.append("G90 ; absolute mode")
        lines.append("G17 ; XY plane")

        unplug_offset = abs(unplug_offset)

        prev_tool = None
        for c in range(cycles):
            for t in tools:
                unplug_y = t.y + unplug_offset
                undock_z = t.z + lift_offset

                approach_step = min(10.0, unplug_offset)

                if c == 0 and prev_tool is None:
                    # Step 2: Pen 1 unplug position at safe Z.
                    lines.append(f"G53 G0 Z{t.safe_z:.2f} F{rapid}")
                    lines.append(f"G53 G0 X{t.x:.2f} Y{unplug_y:.2f} F{rapid}")
                    # Step 3: Pen 1 unplug position at pen Z.
                    lines.append(f"G53 G1 Z{t.z:.2f} F{approach}")
                else:
                    # Step 9: move directly to next pen's unplug position.
                    lines.append(f"G53 G0 X{t.x:.2f} Y{unplug_y:.2f} Z{t.z:.2f} F{rapid}")

                # Step 4: Pen position (slow within 10mm of final pen location).
                if unplug_offset > approach_step:
                    lines.append(f"G53 G0 X{t.x:.2f} Y{t.y + approach_step:.2f} F{rapid}")
                lines.append(f"G53 G1 X{t.x:.2f} Y{t.y:.2f} F{approach}")

                # Step 5: Undock position (lift away from pen).
                if abs(undock_z - t.z) > 10.0:
                    lines.append(f"G53 G1 Z{t.z + 10.0:.2f} F{approach}")
                    lines.append(f"G53 G0 Z{undock_z:.2f} F{rapid}")
                else:
                    lines.append(f"G53 G1 Z{undock_z:.2f} F{approach}")

                # Step 6: 10mm circle in air, ending back at undock position (CW, +Y direction).
                radius = 5.0
                lines.append(f"G3 X{t.x:.2f} Y{t.y:.2f} I0.00 J{radius:.2f} F{rapid}")

                # Step 7: Back to pen position at pen Z.
                if abs(undock_z - t.z) > 10.0:
                    lines.append(f"G53 G0 Z{t.z + 10.0:.2f} F{rapid}")
                    lines.append(f"G53 G1 Z{t.z:.2f} F{approach}")
                else:
                    lines.append(f"G53 G1 Z{t.z:.2f} F{approach}")
                lines.append(f"G53 G1 X{t.x:.2f} Y{t.y:.2f} F{approach}")

                # Step 8: Unplug position (pen Z), slow within 10mm.
                lines.append(f"G53 G1 X{t.x:.2f} Y{t.y + approach_step:.2f} F{approach}")
                if unplug_offset > approach_step:
                    lines.append(f"G53 G0 X{t.x:.2f} Y{unplug_y:.2f} F{rapid}")
                else:
                    lines.append(f"G53 G1 X{t.x:.2f} Y{unplug_y:.2f} F{approach}")

                prev_tool = t

        if tools:
            lines.append(f"G53 G0 Z{tools[-1].safe_z:.2f} F{rapid}")
        lines.append("M2")

        if len(lines) < 5:
            messagebox.showerror("Error", "Generated G-code is unexpectedly short; check tool definitions.")
            return

        with open(file_path, "w") as f:
            f.write("\n".join(lines))
        self.load_gcode_file(file_path)
        messagebox.showinfo("Success", f"Test G-code saved to {file_path} ({len(lines)} lines)")

    def refresh_ports(self):
        ports = list_serial_ports()
        port_names = [dev for dev, _ in ports]
        self.port_combo["values"] = port_names
        if self.config.port in port_names:
            self.port_combo.set(self.config.port)
        elif port_names:
            self.port_combo.set(port_names[0])

    def connect_port(self):
        port_name = self.port_var.get()
        if not port_name:
            messagebox.showerror("Error", "Select a port first")
            return

        def _do_connect():
            try:
                if self.port:
                    self.port.close()
                self.port = open_port(port_name, self.config.baud)
                self.config.port = port_name
                save_config(self.config)
                self.apply_wcs_selection(silent=True)
                self.update_position()
                self._query_grbl_max_rates()
                self.root.after(0, lambda: messagebox.showinfo("Success", f"Connected to {port_name}"))
            except Exception as e:
                self.root.after(0, lambda: messagebox.showerror("Error", f"Failed to connect: {e}"))

        threading.Thread(target=_do_connect, daemon=True).start()

    def unlock_machine(self):
        if not self.port:
            messagebox.showerror("Error", "Not connected!")
            return
        try:
            with self._serial_lock:
                grbl_send(self.port, "$X")
            messagebox.showinfo("Unlocked", "Machine unlocked (movement allowed without homing)")
        except Exception as e:
            messagebox.showerror("Error", f"Unlock failed: {e}")

    def update_jog_label(self, val):
        self.jog_dist_label.config(text=f"{float(val):.1f} mm")

    def update_speed_label(self, val):
        self.jog_speed_label.config(text=f"{int(float(val))} mm/min")

    def jog_axis(self, axis, distance):
        if not self.port:
            messagebox.showerror("Error", "Not connected!")
            return

        try:
            speed = int(self.jog_speed_var.get())
            with self._serial_lock:
                grbl_jog(self.port, axis, distance, speed)
            self.update_position()
        except Exception as e:
            messagebox.showerror("Error", f"Jog failed: {e}")

    def update_dro(self):
        self.machine_label.config(text=f"X: {self.machine_pos['x']:.2f}  Y: {self.machine_pos['y']:.2f}  Z: {self.machine_pos['z']:.2f}")
        self.work_label.config(text=f"X: {self.work_pos['x']:.2f}  Y: {self.work_pos['y']:.2f}  Z: {self.work_pos['z']:.2f}")

    def jog_zero(self):
        if not self.port:
            messagebox.showerror("Error", "Not connected!")
            return
        # Set selected work coordinate system zero at current position
        try:
            wcs = self.wcs_var.get()
            p_num = self.wcs_to_p(wcs)
            with self._serial_lock:
                grbl_send(self.port, f"G10 L20 P{p_num} X0 Y0 Z0")
            self.root.after(200, self.update_position)
            messagebox.showinfo("Info", f"{wcs} zero set to current position")
        except Exception as e:
            # Fallback to local offset if controller command fails
            self.work_offset = self.machine_pos.copy()
            messagebox.showwarning("Warning", f"Set local work offset only. Reason: {e}")

    def home_machine(self):
        if not self.port:
            messagebox.showerror("Error", "Not connected!")
            return

        if messagebox.askyesno("Confirm", "Home the machine?"):
            try:
                with self._serial_lock:
                    grbl_home(self.port, verbose=False)
                self.root.after(1000, self.update_position)
                messagebox.showinfo("Success", "Homing complete")
            except Exception as e:
                messagebox.showerror("Error", f"Home failed: {e}")

    def _grbl_status_safe(self) -> str:
        """Query GRBL status. Must be called with _serial_lock held."""
        try:
            self.port.reset_input_buffer()
            self.port.write(b"?\n")
            for _ in range(10):
                line = self.port.readline().decode("utf-8", errors="ignore").strip()
                if line.startswith("<"):
                    return line
            return ""
        except Exception:
            return ""

    def _update_status_display(self, state: str):
        self.update_dro()
        ok_states = {"Idle", "Run", "Jog", "Hold", "Home", "Check", "Connected"}
        symbol = "🟢" if state in ok_states else "🔴"
        self.status_label.config(text=f"{symbol} {state.upper()}")
        if self.config.port:
            self.port_label.config(text=f"Port: {self.config.port}")

    def update_position(self):
        if not self.port:
            return
        try:
            with self._serial_lock:
                status = self._grbl_status_safe()
            if not status:
                return
            state = status[1:].split("|")[0] if "|" in status else "Connected"
            if "|MPos:" in status:
                mpos_str = status.split("|MPos:")[1].split("|")[0].rstrip(">")
                x, y, z = map(float, mpos_str.split(","))
                self.machine_pos = {"x": x, "y": y, "z": z}
            if "|WPos:" in status:
                wpos_str = status.split("|WPos:")[1].split("|")[0].rstrip(">")
                wx, wy, wz = map(float, wpos_str.split(","))
                self.work_pos = {"x": wx, "y": wy, "z": wz}
            else:
                self.work_pos = {
                    "x": self.machine_pos["x"] - self.work_offset["x"],
                    "y": self.machine_pos["y"] - self.work_offset["y"],
                    "z": self.machine_pos["z"] - self.work_offset["z"],
                }
            self.root.after(0, lambda s=state: self._update_status_display(s))
        except Exception:
            pass

    def status_loop(self):
        while self.running:
            self.update_position()
            time.sleep(0.5)

    def _query_grbl_max_rates(self):
        """Read $110/$111 from GRBL to set the rapid jog speed."""
        if not self.port:
            return
        try:
            with self._serial_lock:
                self.port.write(b"$$\n")
                time.sleep(0.3)
                lines = []
                while self.port.in_waiting:
                    line = self.port.readline().decode("utf-8", errors="ignore").strip()
                    if line:
                        lines.append(line)
            rates = {}
            for line in lines:
                m = re.match(r"\$(\d+)=([\d.]+)", line)
                if m:
                    rates[int(m.group(1))] = float(m.group(2))
            if 110 in rates and 111 in rates:
                self.rapid_jog_speed = int(min(rates[110], rates[111]))
        except Exception:
            pass

    def _make_labeled_frame(self, parent, title, tooltip, **kw):
        """LabelFrame with an inline ? tooltip embedded in the border title."""
        lf = ttk.LabelFrame(parent, **kw)
        header = ttk.Frame(lf)
        ttk.Label(header, text=title, font=("Arial", 9, "bold")).pack(side=LEFT)
        help_lbl = ttk.Label(header, text=" ?", foreground="blue",
                             cursor="question_arrow", font=("Arial", 8), relief="groove")
        help_lbl.pack(side=LEFT, padx=3)
        self.create_tooltip(help_lbl, tooltip)
        lf.configure(labelwidget=header)
        return lf

    def on_tool_select(self, event):
        selection = self.tools_listbox.curselection()
        if selection:
            idx = selection[0]
            tool = self.tools[idx]
            self.tool_name_var.set(tool.name)
            self.tool_color_var.set(tool.color)
            self.tool_x_var.set(tool.x)
            self.tool_y_var.set(tool.y)
            self.tool_z_var.set(tool.z)
            self.tool_safe_z_var.set(tool.safe_z)

    def refresh_tool_list(self):
        self.tools_listbox.delete(0, END)
        for tool in self.tools:
            self.tools_listbox.insert(END, f"{tool.name} ({tool.color}) - X:{tool.x:.1f} Y:{tool.y:.1f} Z:{tool.z:.1f}")

    def add_tool(self):
        name = self.tool_name_var.get().strip()
        if not name:
            messagebox.showwarning("Warning", "Enter a tool name")
            return

        color = self.tool_color_var.get().strip()
        try:
            x = self.tool_x_var.get()
            y = self.tool_y_var.get()
            z = self.tool_z_var.get()
            safe_z = self.tool_safe_z_var.get()
        except:
            messagebox.showerror("Error", "Invalid coordinates")
            return

        tool = Tool(name=name, color=color, x=x, y=y, z=z, safe_z=safe_z)
        add_or_update_tool(self.tools, tool)
        save_tools(self.config.tools_path, self.tools)
        self.refresh_tool_list()
        self.refresh_pen_buttons()
        messagebox.showinfo("Success", f"Tool '{name}' added")

    def save_tool(self):
        selection = self.tools_listbox.curselection()
        if not selection:
            messagebox.showwarning("Warning", "Select a tool to edit")
            return

        idx = selection[0]
        name = self.tool_name_var.get().strip()
        if not name:
            messagebox.showwarning("Warning", "Enter a tool name")
            return

        color = self.tool_color_var.get().strip()
        try:
            x = self.tool_x_var.get()
            y = self.tool_y_var.get()
            z = self.tool_z_var.get()
            safe_z = self.tool_safe_z_var.get()
        except:
            messagebox.showerror("Error", "Invalid coordinates")
            return

        tool = Tool(name=name, color=color, x=x, y=y, z=z, safe_z=safe_z)
        add_or_update_tool(self.tools, tool)
        save_tools(self.config.tools_path, self.tools)
        self.refresh_tool_list()
        self.refresh_pen_buttons()
        messagebox.showinfo("Success", f"Tool '{name}' updated")

    def go_to_tool(self):
        selection = self.tools_listbox.curselection()
        if not selection:
            messagebox.showwarning("Warning", "Select a tool")
            return

        if not self.port:
            messagebox.showerror("Error", "Not connected!")
            return

        idx = selection[0]
        tool = self.tools[idx]

        try:
            if tool.safe_z != tool.z:
                with self._serial_lock:
                    grbl_move_abs(self.port, tool.x, tool.y, tool.safe_z, use_machine_coords=True)
                time.sleep(0.5)
            with self._serial_lock:
                grbl_move_abs(self.port, tool.x, tool.y, tool.z, use_machine_coords=True)
            self.root.after(1000, self.update_position)
            messagebox.showinfo("Success", f"Moved to {tool.name}")
        except Exception as e:
            messagebox.showerror("Error", f"Move failed: {e}")

    def delete_tool(self):
        selection = self.tools_listbox.curselection()
        if not selection:
            messagebox.showwarning("Warning", "Select a tool")
            return

        idx = selection[0]
        tool = self.tools[idx]

        if messagebox.askyesno("Confirm", f"Delete '{tool.name}'?"):
            remove_tool(self.tools, tool.name)
            save_tools(self.config.tools_path, self.tools)
            self.refresh_tool_list()
            self.refresh_pen_buttons()
            messagebox.showinfo("Success", f"Deleted '{tool.name}'")

    def refresh_pen_buttons(self):
        """Refresh pen shortcut buttons based on current tools"""
        # Clear existing buttons
        for widget in self.pen_buttons_frame.winfo_children():
            widget.destroy()
        
        if not self.tools:
            ttk.Label(self.pen_buttons_frame, text="(No tools)").pack()
            return
        
        # Create Up/Down buttons for each tool
        for tool in self.tools:
            tool_frame = ttk.Frame(self.pen_buttons_frame)
            tool_frame.pack(fill=X, pady=2)
            ttk.Label(tool_frame, text=f"{tool.name}", width=12).pack(side=LEFT)
            ttk.Button(tool_frame, text="↑ Up", width=8, 
                      command=lambda t=tool: self.move_to_pen_safe_z(t)).pack(side=LEFT, padx=2)
            ttk.Button(tool_frame, text="↓ Down", width=8,
                      command=lambda t=tool: self.move_to_pen(t)).pack(side=LEFT, padx=2)

    def move_to_pen_safe_z(self, tool):
        """Move to pen safe Z (pen up) - tool positions are in machine coordinates"""
        print(f"\n[PEN] Pen Up clicked for: {tool.name}")
        print(f"[PEN] Port connected: {self.port is not None}")
        print(f"[PEN] Tool data: X={tool.x}, Y={tool.y}, Safe_Z={tool.safe_z}, Z={tool.z}")
        
        if not self.port:
            print("[PEN] ERROR: Not connected!")
            messagebox.showerror("Error", "Not connected!")
            return
        try:
            print(f"[PEN] Sending move_abs to: X={tool.x:.2f}, Y={tool.y:.2f}, Z={tool.safe_z:.2f}")
            with self._serial_lock:
                grbl_move_abs(self.port, tool.x, tool.y, tool.safe_z, use_machine_coords=True)
            print("[PEN] Move command sent, waiting 0.5s...")
            time.sleep(0.5)
            self.update_position()
            print("[PEN] Move complete")
        except Exception as e:
            print(f"[PEN] ERROR: {e}")
            messagebox.showerror("Error", f"Move failed: {e}")

    def move_to_pen(self, tool):
        """Move to pen Z (pen down docked) - tool positions are in machine coordinates"""
        print(f"\n[PEN] Pen Down clicked for: {tool.name}")
        print(f"[PEN] Port connected: {self.port is not None}")
        print(f"[PEN] Tool data: X={tool.x}, Y={tool.y}, Z={tool.z}, Safe_Z={tool.safe_z}")
        
        if not self.port:
            print("[PEN] ERROR: Not connected!")
            messagebox.showerror("Error", "Not connected!")
            return
        try:
            print(f"[PEN] Sending moves to: X={tool.x:.2f}, Y={tool.y:.2f}, Safe_Z={tool.safe_z:.2f}, Z={tool.z:.2f}")
            if tool.safe_z != tool.z:
                print(f"[PEN] First move to safe Z: {tool.safe_z}")
                with self._serial_lock:
                    grbl_move_abs(self.port, tool.x, tool.y, tool.safe_z, use_machine_coords=True)
                time.sleep(0.5)
            print(f"[PEN] Final move to Z: {tool.z}")
            with self._serial_lock:
                grbl_move_abs(self.port, tool.x, tool.y, tool.z, use_machine_coords=True)
            time.sleep(0.5)
            self.update_position()
            print("[PEN] Move complete")
        except Exception as e:
            print(f"[PEN] ERROR: {e}")
            messagebox.showerror("Error", f"Move failed: {e}")
    _JOG_KEY_MAP = {
        "up":    ("Y",  1),
        "down":  ("Y", -1),
        "left":  ("X", -1),
        "right": ("X",  1),
        "u":     ("Z",  1),
        "d":     ("Z", -1),
        "prior": ("Z",  1),  # Page Up
        "next":  ("Z", -1),  # Page Down
    }
    _JOG_HOLD_MS = 350  # ms held before switching from single-step to continuous

    def on_key_press(self, event):
        key = event.keysym.lower()
        if key in ("shift_l", "shift_r"):
            self._shift_held = True
            if self.port and self.jog_keys_held:
                if self._continuous_jog_active:
                    # Already in continuous jog — cancel and restart at rapid speed
                    try:
                        with self._serial_lock:
                            self.port.write(b"\x85")
                            self.port.flush()
                    except Exception:
                        pass
                    self._start_continuous_jog()
                elif self._jog_after_id is not None:
                    # Still in the hold-timer window — skip straight to rapid
                    self.root.after_cancel(self._jog_after_id)
                    self._jog_after_id = None
                    self._start_continuous_jog()
            return
        if not self.port:
            return
        if key not in self._JOG_KEY_MAP:
            return

        # Cancel any pending release — this KeyPress is X11 auto-repeat, not a new press
        if key in self._pending_release:
            self.root.after_cancel(self._pending_release.pop(key))

        if key in self.jog_keys_held:
            return  # Already handling this axis

        self.jog_keys_held.add(key)

        if self._shift_held:
            # Rapid mode: skip single-step stutter, go straight to continuous
            if self._jog_after_id is not None:
                self.root.after_cancel(self._jog_after_id)
                self._jog_after_id = None
            self._start_continuous_jog()
        else:
            # Normal: single step, then continuous after hold delay
            axis, sign = self._JOG_KEY_MAP[key]
            speed = int(self.jog_speed_var.get())
            dist = self.jog_dist_var.get()
            try:
                with self._serial_lock:
                    grbl_jog(self.port, axis, sign * dist, speed)
            except Exception:
                pass
            if self._jog_after_id is None:
                self._jog_after_id = self.root.after(self._JOG_HOLD_MS, self._start_continuous_jog)

    def _start_continuous_jog(self):
        self._jog_after_id = None
        if not self.jog_keys_held or not self.port:
            return
        self._continuous_jog_active = True
        speed = self.rapid_jog_speed if self._shift_held else int(self.jog_speed_var.get())
        try:
            with self._serial_lock:
                for key in list(self.jog_keys_held):
                    axis, sign = self._JOG_KEY_MAP[key]
                    grbl_jog(self.port, axis, sign * 10000, speed)
        except Exception:
            pass

    def on_key_release(self, event):
        key = event.keysym.lower()
        if key in ("shift_l", "shift_r"):
            self._shift_held = False
            return
        if key not in self._JOG_KEY_MAP:
            return
        # Defer 20ms to absorb X11 auto-repeat (fake release+press pairs arrive < 5ms apart)
        after_id = self.root.after(20, lambda k=key: self._do_key_release(k))
        self._pending_release[key] = after_id

    def _do_key_release(self, key):
        self._pending_release.pop(key, None)
        self.jog_keys_held.discard(key)
        if not self.jog_keys_held:
            if self._jog_after_id is not None:
                self.root.after_cancel(self._jog_after_id)
                self._jog_after_id = None
            if self.port:
                if self._continuous_jog_active:
                    try:
                        with self._serial_lock:
                            self.port.write(b"\x85")
                            self.port.flush()
                    except Exception:
                        pass
                self.root.after(400, self.update_position)
            self._continuous_jog_active = False

    def disconnect_port(self):
        if not self.port:
            messagebox.showinfo("Info", "Not connected")
            return
        try:
            self.port.close()
        except Exception:
            pass
        self.port = None
        self.status_label.config(text="🔴 DISCONNECTED")
        self.port_label.config(text="Port: None")
        messagebox.showinfo("Disconnected", "Port closed")

    def on_closing(self):
        self.running = False
        if self.port:
            try:
                self.port.close()
            except Exception:
                pass
        self.root.destroy()
        os._exit(0)

    def create_tooltip(self, widget, text):
        """Create a simple tooltip that appears on hover"""
        def on_enter(event):
            try:
                tooltip = Toplevel()
                tooltip.wm_overrideredirect(True)
                tooltip.wm_geometry(f"+{event.x_root+10}+{event.y_root+10}")
                label = Label(tooltip, text=text, background="lightyellow", relief=SOLID, borderwidth=1, font=("Arial", 9))
                label.pack(padx=5, pady=3)
                widget.tooltip = tooltip
            except:
                pass
        
        def on_leave(event):
            try:
                if hasattr(widget, 'tooltip'):
                    widget.tooltip.destroy()
                    delattr(widget, 'tooltip')
            except:
                pass
        
        widget.bind("<Enter>", on_enter)
        widget.bind("<Leave>", on_leave)

    def wcs_to_p(self, wcs: str) -> int:
        mapping = {"G54": 1, "G55": 2, "G56": 3, "G57": 4, "G58": 5, "G59": 6}
        return mapping.get(wcs, 1)

    def on_wcs_change(self, event=None):
        self.apply_wcs_selection(silent=False)

    def apply_wcs_selection(self, silent: bool = False):
        if not self.port:
            if not silent:
                messagebox.showwarning("Warning", "Not connected; WCS will apply after connect")
            return
        try:
            wcs = self.wcs_var.get()
            with self._serial_lock:
                grbl_send(self.port, wcs)
            self.root.after(200, self.update_position)
            if not silent:
                messagebox.showinfo("WCS", f"Active work coordinate system: {wcs}")
        except Exception as e:
            if not silent:
                messagebox.showerror("Error", f"Failed to set WCS: {e}")

    def zero_wcs_axis(self, axis: str):
        if not self.port:
            messagebox.showerror("Error", "Not connected!")
            return
        axis = axis.upper()
        if axis not in {"X", "Y", "Z"}:
            messagebox.showerror("Error", "Axis must be X, Y, or Z")
            return
        try:
            wcs = self.wcs_var.get()
            p_num = self.wcs_to_p(wcs)
            with self._serial_lock:
                grbl_send(self.port, f"G10 L20 P{p_num} {axis}0")
            self.root.after(200, self.update_position)
            messagebox.showinfo("Work Zero", f"{wcs} {axis} set to 0")
        except Exception as e:
            messagebox.showerror("Error", f"Failed to zero {axis}: {e}")

    def zero_wcs_all(self):
        if not self.port:
            messagebox.showerror("Error", "Not connected!")
            return
        try:
            wcs = self.wcs_var.get()
            p_num = self.wcs_to_p(wcs)
            with self._serial_lock:
                grbl_send(self.port, f"G10 L20 P{p_num} X0 Y0 Z0")
            self.root.after(200, self.update_position)
            messagebox.showinfo("Work Zero", f"{wcs} X/Y/Z set to 0")
        except Exception as e:
            messagebox.showerror("Error", f"Failed to zero all: {e}")


def main():
    if not has_display:
        print("No display found. Running terminal mode instead...")
        print("Use: python3 pl0tb0t_control.py")
        import pl0tb0t_control
        try:
            controller = pl0tb0t_control.PlotterControl()
            controller.menu_main()
        except KeyboardInterrupt:
            print("\n\nInterrupted!")
            sys.exit(0)
    else:
        root = Tk()
        app = PlotterGUI(root)
        root.protocol("WM_DELETE_WINDOW", app.on_closing)
        root.mainloop()


if __name__ == "__main__":
    main()
