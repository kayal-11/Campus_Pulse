import pandas as pd

for path in ['dataset/train.feather', 'dataset/building_metadata.feather', 'dataset/weather_train.feather']:
    df = pd.read_feather(path)
    print('FILE:', path)
    print('shape', df.shape)
    print('columns', list(df.columns))
    print(df.head(3).to_string())
    print('---')
