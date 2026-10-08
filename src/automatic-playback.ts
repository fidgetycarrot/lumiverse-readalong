/** One local start per selected reading. Progress, failures and pauses cannot rearm it. */
export class AutomaticPlayback {
  private armed=false;
  arm(eligible=true){this.armed=eligible}
  cancel(){this.armed=false}
  take(state:{enabled:boolean;automatic:boolean;ready:boolean;busy:boolean}):boolean {
    if(!this.armed || !state.enabled || !state.automatic || !state.ready || state.busy)return false;
    this.armed=false;return true;
  }
}
