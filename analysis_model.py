import pandas as pd
import numpy as np
import joblib
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

train = pd.read_feather('dataset/train.feather')
model = joblib.load('backend/energy_model.pkl')
print('model type', type(model))
print('coef', model.coef_.tolist())
print('intercept', float(model.intercept_))

# evaluate on sample rows
sample = train.sample(n=10000, random_state=123)
X = sample[['building_id', 'meter']].values
y = sample['meter_reading'].values
pred = model.predict(X)
print('MAE', mean_absolute_error(y, pred))
print('RMSE', np.sqrt(mean_squared_error(y, pred)))
print('R2', r2_score(y, pred))
print('pred min', float(pred.min()), 'pred max', float(pred.max()))
print('negative preds count', int((pred < 0).sum()))

cmp = sample.sample(n=20, random_state=42).copy()
cmp['predicted'] = model.predict(cmp[['building_id','meter']].values)
cmp['abs_err'] = (cmp['meter_reading'] - cmp['predicted']).abs()
cmp['pct_err'] = cmp['abs_err'] / (cmp['meter_reading'].replace(0, np.nan)).abs() * 100
print(cmp[['building_id','meter','timestamp','meter_reading','predicted','abs_err','pct_err']].to_string(index=False))
