import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

/**
 * A missing reachability result is treated as online so first boot never
 * blocks the local app while the native network monitor is still resolving.
 */
export function useNetworkStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => NetInfo.addEventListener((state) => {
    setOnline(state.isConnected !== false && state.isInternetReachable !== false);
  }), []);

  return online;
}
