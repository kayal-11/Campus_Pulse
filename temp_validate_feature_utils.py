from backend.feature_utils import _get_weather_features, _load_weather_data
from datetime import datetime

try:
    _load_weather_data()
    data = _get_weather_features(0, datetime(2016, 1, 1, 0, 0))
    print('OK', data)
except Exception as exc:
    import traceback
    traceback.print_exc()
