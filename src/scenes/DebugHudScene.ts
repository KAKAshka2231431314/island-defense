import Phaser from 'phaser';

/** Отладочный текст поверх игры (не зависит от зума камеры). Текст берётся из registry 'hudText'. */
export class DebugHudScene extends Phaser.Scene {
  private label!: Phaser.GameObjects.Text;
  private last = '';

  constructor() {
    super('DebugHud');
  }

  create(): void {
    this.last = '';
    this.label = this.add.text(12, 12, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffffff',
      backgroundColor: 'rgba(0,0,0,0.55)',
      padding: { x: 8, y: 6 },
    });
  }

  update(): void {
    const text = String(this.registry.get('hudText') ?? '');
    if (text === this.last) return;
    this.last = text;
    this.label.setText(text).setVisible(text.length > 0);
  }
}
