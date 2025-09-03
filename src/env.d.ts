/// <reference types="vite/client" />

declare global {
    interface Window {
        showOpenFilePicker: (options?: { types?: { accept: string }[], multiple?: boolean }) => Promise<FileSystemFileHandle[]>;
        showDirectoryPicker: (options?: { startIn?: string }) => Promise<FileSystemDirectoryHandle[]>;
    }
}