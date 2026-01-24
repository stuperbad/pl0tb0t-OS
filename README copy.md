## Interactive Drawing Machine

* `UI.py`: handles the user interface / pygame. 
* `art.py`: generates the particular art. (this could be swapped out for different art generator)
* `sendtopi.sh`: some reference commands for sending stuff to / from pi

## How to run

First clone repo to the pi. Then install all the requirements: 

`pip install requirements.txt`

Then try running the user interface (from the pi after hooking up all the electronics): 

`python3 UI.py`

This should boot up the pygame interface. 