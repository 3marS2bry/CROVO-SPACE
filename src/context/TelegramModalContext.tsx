import React, { createContext, useCallback, useContext, useState } from 'react';

export const CROVO_TELEGRAM_URL = 'https://t.me/CrovoSpace';

interface TelegramModalContextValue {
  isOpen: boolean;
  source: string | null;
  openTelegramModal: (source?: string) => void;
  closeTelegramModal: () => void;
}

const TelegramModalContext = createContext<TelegramModalContextValue>({
  isOpen: false,
  source: null,
  openTelegramModal: () => {},
  closeTelegramModal: () => {},
});

export const TelegramModalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [source, setSource] = useState<string | null>(null);

  const openTelegramModal = useCallback((triggerSource?: string) => {
    setSource(triggerSource || null);
    setIsOpen(true);
  }, []);

  const closeTelegramModal = useCallback(() => {
    setIsOpen(false);
  }, []);

  return (
    <TelegramModalContext.Provider
      value={{
        isOpen,
        source,
        openTelegramModal,
        closeTelegramModal,
      }}
    >
      {children}
    </TelegramModalContext.Provider>
  );
};

export function useTelegramModal() {
  return useContext(TelegramModalContext);
}
