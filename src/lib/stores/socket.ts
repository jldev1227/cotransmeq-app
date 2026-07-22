import { writable } from 'svelte/store';
import { io, Socket } from 'socket.io-client';
import { browser } from '$app/environment';

export const socketStore = writable<Socket | null>(null);

export const connectSocket = () => {
  if (browser) {
    const socket = io(import.meta.env.VITE_API_URL, {
      transports: ['websocket'],
    });

    socket.on('connect', () => {
      console.log('Socket connected:', socket.id);
      socketStore.set(socket);
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected');
      socketStore.set(null);
    });

    return () => {
      socket.disconnect();
    };
  }
};
