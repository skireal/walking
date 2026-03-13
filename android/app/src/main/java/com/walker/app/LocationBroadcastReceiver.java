package com.walker.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import com.google.android.gms.location.LocationResult;

import org.json.JSONArray;
import org.json.JSONObject;

public class LocationBroadcastReceiver extends BroadcastReceiver {

    public static final String ACTION_LOCATION_UPDATE = "com.walker.app.LOCATION_UPDATE";
    public static final String PREFS_NAME = "LocationBuffer";
    public static final String PREFS_KEY = "buffered_locations";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!LocationResult.hasResult(intent)) return;

        LocationResult result = LocationResult.extractResult(intent);
        if (result == null) return;

        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String existing = prefs.getString(PREFS_KEY, "[]");

        try {
            JSONArray array = new JSONArray(existing);
            for (android.location.Location location : result.getLocations()) {
                JSONObject obj = new JSONObject();
                obj.put("latitude", location.getLatitude());
                obj.put("longitude", location.getLongitude());
                obj.put("accuracy", location.getAccuracy());
                obj.put("time", location.getTime());
                if (location.hasSpeed())    obj.put("speed", location.getSpeed());
                if (location.hasBearing())  obj.put("bearing", location.getBearing());
                if (location.hasAltitude()) obj.put("altitude", location.getAltitude());
                array.put(obj);
            }
            prefs.edit().putString(PREFS_KEY, array.toString()).apply();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
