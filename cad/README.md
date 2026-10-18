# pen tool-changer CAD

Each folder is one design family. Rebuild a design with the python file in it; `build_viewer.py` makes a
standalone `viewer.html` (not committed).

| Folder | What it is | Status |
|---|---|---|
| `bushing-pin-coupler/vertical-pins/` | **Current.** Tool hangs below the carriage; 2 steel pins point down into stacked bronze bushings, big printed funnels, 1 D6x6 magnet per part. No actuator. | first pass, not printed |
| `bushing-pin-coupler/horizontal-pins/` | Same idea with pins along the insertion axis (wrong orientation for the plotter; kept for reference). | superseded |
| `solenoid-latch/` | Kinematic seats + spring-closed keyhole latch released by a solenoid. | parked |
| `kinematic-seats/` | Three-groove balls-and-dowels coupling (used by `solenoid-latch`). | parked |
| `old-cone-seats/` | First printed-cone-seat attempt. | dead |

Reference: UTC (Ultimate Tool Changer) V2.0 STL/BOM in Downloads: 6 dowels + 3 cone-tip set screws as the
kinematic seat, 6 D10x3 magnets in the carriage plate, 3x10 pins into 6 mm bushings in the dock.
