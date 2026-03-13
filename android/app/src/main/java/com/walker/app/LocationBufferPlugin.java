package com.walker.app;

import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

@CapacitorPlugin(name = "LocationBuffer")
public class LocationBufferPlugin extends Plugin {

    private FusedLocationProviderClient fusedLocationClient;
    private PendingIntent locationPendingIntent;

    @Override
    public void load() {
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(getActivity());
    }

    @PluginMethod
    public void startBuffering(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), LocationBroadcastReceiver.class);
            intent.setAction(LocationBroadcastReceiver.ACTION_LOCATION_UPDATE);

            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                flags |= PendingIntent.FLAG_MUTABLE;
            }

            locationPendingIntent = PendingIntent.getBroadcast(getContext(), 0, intent, flags);

            LocationRequest locationRequest = new LocationRequest.Builder(
                Priority.PRIORITY_HIGH_ACCURACY, 5000L
            ).setMinUpdateDistanceMeters(3f).build();

            fusedLocationClient.requestLocationUpdates(locationRequest, locationPendingIntent);
            call.resolve();
        } catch (SecurityException e) {
            call.reject("Location permission not granted", e);
        }
    }

    @PluginMethod
    public void getAndClearBuffer(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(
            LocationBroadcastReceiver.PREFS_NAME, android.content.Context.MODE_PRIVATE
        );
        String json = prefs.getString(LocationBroadcastReceiver.PREFS_KEY, "[]");
        prefs.edit().putString(LocationBroadcastReceiver.PREFS_KEY, "[]").apply();

        JSObject result = new JSObject();
        result.put("locations", json);
        call.resolve(result);
    }

    @PluginMethod
    public void stopBuffering(PluginCall call) {
        if (locationPendingIntent != null) {
            fusedLocationClient.removeLocationUpdates(locationPendingIntent);
            locationPendingIntent = null;
        }
        call.resolve();
    }
}
