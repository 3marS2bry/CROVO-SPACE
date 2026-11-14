// Sound effects completely disabled per user preference ("شيل الصوت لانو مقرف")

class SilentEffectsManager {
  public toggleSound(): boolean {
    return false;
  }

  public isEnabled(): boolean {
    return false;
  }

  public playClick() {
    // Disabled
  }

  public playCopySuccess() {
    // Disabled
  }

  public playLevelUp() {
    // Disabled
  }
}

export const sounds = new SilentEffectsManager();
