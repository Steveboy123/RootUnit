#!/usr/bin/env python3
import json, os, re, subprocess, sys, time

os.environ.setdefault('LC_ALL', 'C')
MAC_RE = re.compile(r'^[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}$')
UUID_RE = re.compile(r'^[0-9A-Fa-f-]{8,64}$')


def fail(msg, code=1):
    print(json.dumps({'ok': False, 'error': str(msg)}))
    raise SystemExit(code)


def run(args, timeout=20, check=True, input_text=None):
    try:
        p = subprocess.run(args, input=input_text, text=True, capture_output=True, timeout=timeout, env=os.environ)
    except FileNotFoundError:
        fail(f'{args[0]} is not installed')
    except subprocess.TimeoutExpired:
        fail(f'{args[0]} timed out')
    if check and p.returncode != 0:
        msg = (p.stderr or p.stdout or f'{args[0]} failed').strip().splitlines()
        fail(msg[-1] if msg else f'{args[0]} failed')
    return p.stdout


def read_payload():
    raw = sys.stdin.read(16384)
    if not raw.strip():
        return {}
    try:
        v = json.loads(raw)
    except Exception:
        fail('Invalid request')
    if not isinstance(v, dict):
        fail('Invalid request')
    return v


def split_nm(line):
    out, buf, esc = [], [], False
    for ch in line.rstrip('\n'):
        if esc:
            buf.append(ch)
            esc = False
        elif ch == '\\':
            esc = True
        elif ch == ':':
            out.append(''.join(buf)); buf=[]
        else:
            buf.append(ch)
    if esc:
        buf.append('\\')
    out.append(''.join(buf))
    return out


def boolish(s):
    return str(s).strip().lower() in ('yes','true','1','enabled','on')


def wifi_state(rescan=False):
    powered = run(['nmcli','radio','wifi']).strip().lower() == 'enabled'

    devs=[]
    txt=run(['nmcli','-t','-e','yes','-f','DEVICE,TYPE,STATE,CONNECTION','device','status'])
    for line in txt.splitlines():
        p=split_nm(line)
        if len(p)>=4 and p[1]=='wifi':
            devs.append({'device':p[0], 'state':p[2], 'connection':p[3] if p[3] != '--' else ''})
    dev = next((d for d in devs if d['state']=='connected'), devs[0] if devs else None)
    iface = dev['device'] if dev else ''

    active_uuids=set()
    for line in run(['nmcli','-t','-e','yes','-f','UUID,TYPE','connection','show','--active']).splitlines():
        p=split_nm(line)
        if len(p)>=2 and p[1] in ('wifi','802-11-wireless'):
            active_uuids.add(p[0])

    saved=[]
    saved_ssids={}
    for line in run(['nmcli','-t','-e','yes','-f','NAME,UUID,TYPE,AUTOCONNECT','connection','show']).splitlines():
        p=split_nm(line)
        if len(p)<4 or p[2] not in ('wifi','802-11-wireless'):
            continue
        uuid=p[1]
        ssid=run(['nmcli','-g','802-11-wireless.ssid','connection','show','uuid',uuid], check=False).strip()
        item={'name':p[0], 'uuid':uuid, 'ssid':ssid or p[0], 'autoconnect':boolish(p[3]), 'active':uuid in active_uuids}
        saved.append(item)
        if ssid:
            saved_ssids.setdefault(ssid, []).append(item)

    networks=[]
    if powered and iface:
        mode='yes' if rescan else 'auto'
        out=run(['nmcli','-t','-e','yes','-f','IN-USE,SSID,BSSID,SIGNAL,SECURITY,FREQ','device','wifi','list','ifname',iface,'--rescan',mode], timeout=25, check=False)
        seen=set()
        for line in out.splitlines():
            p=split_nm(line)
            if len(p)<6 or not p[1]:
                continue
            key=(p[1],p[2])
            if key in seen:
                continue
            seen.add(key)
            try: signal=max(0,min(100,int(p[3] or 0)))
            except: signal=0
            try: freq=int(p[5] or 0)
            except: freq=0
            matches=saved_ssids.get(p[1],[])
            networks.append({
                'ssid':p[1], 'bssid':p[2], 'signal':signal, 'security':p[4] if p[4] not in ('--','') else 'Open',
                'frequency':freq, 'active':p[0]=='*', 'saved':bool(matches), 'savedUuid':matches[0]['uuid'] if matches else None
            })
        networks.sort(key=lambda n:(not n['active'], -n['signal'], n['ssid'].lower()))

    ip4=''; gateway=''
    if iface:
        addrs=run(['nmcli','-g','IP4.ADDRESS','device','show',iface], check=False).strip().splitlines()
        ip4=addrs[0] if addrs else ''
        gw_text=run(['nmcli','-g','IP4.GATEWAY','device','show',iface], check=False).strip()
        gateway=gw_text.splitlines()[0] if gw_text else ''
    return {'available': bool(devs), 'powered': powered, 'device': iface, 'state': dev['state'] if dev else 'unavailable', 'connection': dev['connection'] if dev else '', 'ip4': ip4, 'gateway': gateway, 'networks': networks, 'saved': saved}


def valid_uuid(v):
    return isinstance(v,str) and bool(UUID_RE.match(v))


def wifi_action(action, p):
    state=wifi_state(False)
    iface=str(p.get('device') or state.get('device') or '')
    if action=='wifi-power':
        run(['nmcli','radio','wifi','on' if bool(p.get('enabled')) else 'off'])
    elif action=='wifi-scan':
        return wifi_state(True)
    elif action=='wifi-connect':
        uuid=p.get('uuid')
        if uuid:
            if not valid_uuid(uuid): fail('Invalid saved network')
            cmd=['nmcli','connection','up','uuid',uuid]
            if iface: cmd += ['ifname',iface]
            run(cmd, timeout=35)
        else:
            ssid=str(p.get('ssid') or '')
            if not ssid or len(ssid)>128: fail('Invalid Wi-Fi name')
            cmd=['nmcli','device','wifi','connect',ssid]
            password=p.get('password')
            bssid=str(p.get('bssid') or '')
            if isinstance(password,str) and password: cmd += ['password',password]
            if iface: cmd += ['ifname',iface]
            if bssid:
                if not MAC_RE.match(bssid): fail('Invalid BSSID')
                cmd += ['bssid',bssid]
            run(cmd, timeout=45)
    elif action=='wifi-disconnect':
        if not iface: fail('No Wi-Fi adapter found')
        run(['nmcli','device','disconnect',iface], timeout=20)
    elif action=='wifi-forget':
        uuid=p.get('uuid')
        if not valid_uuid(uuid): fail('Invalid saved network')
        run(['nmcli','connection','delete','uuid',uuid])
    elif action=='wifi-edit':
        uuid=p.get('uuid')
        if not valid_uuid(uuid): fail('Invalid saved network')
        autoconnect=p.get('autoconnect')
        if isinstance(autoconnect,bool):
            run(['nmcli','connection','modify','uuid',uuid,'connection.autoconnect','yes' if autoconnect else 'no'])
        name=p.get('name')
        if isinstance(name,str) and name.strip():
            n=name.strip()
            if len(n)>80: fail('Connection name is too long')
            run(['nmcli','connection','modify','uuid',uuid,'connection.id',n])
        password=p.get('password')
        if isinstance(password,str) and password:
            if len(password)>128: fail('Wi-Fi password is too long')
            run(['nmcli','connection','modify','uuid',uuid,'802-11-wireless-security.psk',password])
        if bool(p.get('reconnect')):
            cmd=['nmcli','connection','up','uuid',uuid]
            if iface: cmd += ['ifname',iface]
            run(cmd, timeout=35)
    else:
        fail('Unsupported Wi-Fi action')
    time.sleep(0.5)
    return wifi_state(False)


def parse_bt_info(text, addr, fallback_name=''):
    item={'address':addr.upper(), 'name':fallback_name or addr.upper(), 'alias':fallback_name or addr.upper(), 'paired':False, 'trusted':False, 'connected':False, 'blocked':False}
    for raw in text.splitlines():
        line=raw.strip()
        if ':' not in line: continue
        k,v=line.split(':',1); k=k.strip(); v=v.strip()
        if k=='Name' and v: item['name']=v
        elif k=='Alias' and v: item['alias']=v
        elif k=='Icon' and v: item['icon']=v
        elif k=='Paired': item['paired']=boolish(v)
        elif k=='Trusted': item['trusted']=boolish(v)
        elif k=='Connected': item['connected']=boolish(v)
        elif k=='Blocked': item['blocked']=boolish(v)
        elif k=='RSSI':
            try: item['rssi']=int(v)
            except: pass
    return item


def bluetooth_state(scan=False):
    show=run(['bluetoothctl','show'], check=False)
    if not show.strip() or 'No default controller available' in show:
        return {'available':False,'powered':False,'discoverable':False,'pairable':False,'devices':[],'error':'No Bluetooth controller found'}
    powered=discoverable=pairable=False
    controller=''
    for raw in show.splitlines():
        line=raw.strip()
        if line.startswith('Controller '):
            parts=line.split(); controller=parts[1] if len(parts)>1 else ''
        elif line.startswith('Powered:'): powered=boolish(line.split(':',1)[1])
        elif line.startswith('Discoverable:'): discoverable=boolish(line.split(':',1)[1])
        elif line.startswith('Pairable:'): pairable=boolish(line.split(':',1)[1])
    if scan and powered:
        run(['bluetoothctl','--timeout','6','scan','on'], timeout=9, check=False)
    devices=[]
    out=run(['bluetoothctl','devices'], check=False)
    seen=set()
    for line in out.splitlines():
        m=re.match(r'^Device\s+([0-9A-Fa-f:]{17})\s+(.+)$', line.strip())
        if not m: continue
        addr=m.group(1).upper()
        if addr in seen: continue
        seen.add(addr)
        info=run(['bluetoothctl','info',addr], check=False)
        devices.append(parse_bt_info(info,addr,m.group(2).strip()))
    devices.sort(key=lambda d:(not d['connected'], not d['paired'], (d.get('alias') or d['name']).lower()))
    return {'available':True,'powered':powered,'discoverable':discoverable,'pairable':pairable,'controller':controller,'devices':devices}


def bt_addr(p):
    addr=str(p.get('address') or '').upper()
    if not MAC_RE.match(addr): fail('Invalid Bluetooth address')
    return addr


def bt_action(action,p):
    if action=='bt-power':
        run(['bluetoothctl','power','on' if bool(p.get('enabled')) else 'off'])
    elif action=='bt-scan':
        return bluetooth_state(True)
    elif action=='bt-discoverable':
        enabled=bool(p.get('enabled'))
        if enabled:
            run(['bluetoothctl','pairable','on'])
            run(['bluetoothctl','discoverable-timeout','120'], check=False)
        run(['bluetoothctl','discoverable','on' if enabled else 'off'])
    elif action=='bt-pair':
        addr=bt_addr(p)
        # NoInputNoOutput gives car-head-unit style JustWorks pairing; the phone may still ask the user to confirm.
        run(['bluetoothctl','--agent','NoInputNoOutput','--timeout','35','pair',addr], timeout=40)
        run(['bluetoothctl','trust',addr], check=False)
        run(['bluetoothctl','connect',addr], timeout=25, check=False)
    elif action=='bt-connect':
        run(['bluetoothctl','connect',bt_addr(p)], timeout=25)
    elif action=='bt-disconnect':
        run(['bluetoothctl','disconnect',bt_addr(p)], timeout=20)
    elif action=='bt-forget':
        run(['bluetoothctl','remove',bt_addr(p)], timeout=20)
    elif action=='bt-trust':
        run(['bluetoothctl','trust' if bool(p.get('trusted')) else 'untrust',bt_addr(p)])
    elif action=='bt-rename':
        addr=bt_addr(p)
        alias=str(p.get('alias') or '').strip()
        if not alias or len(alias)>64: fail('Bluetooth name must be 1–64 characters')
        suffix='dev_' + addr.replace(':','_')
        tree=run(['busctl','tree','org.bluez'], check=False)
        match=re.search(r'(/org/bluez/hci[0-9]+/' + re.escape(suffix) + r')', tree)
        if not match: fail('Bluetooth device is not available to rename')
        run(['busctl','set-property','org.bluez',match.group(1),'org.bluez.Device1','Alias','s',alias])
    else:
        fail('Unsupported Bluetooth action')
    time.sleep(0.5)
    return bluetooth_state(False)


def main():
    action=sys.argv[1] if len(sys.argv)>1 else 'state'
    payload=read_payload()
    if action=='state':
        result={'ok':True,'wifi':wifi_state(False),'bluetooth':bluetooth_state(False)}
    elif action.startswith('wifi-'):
        result={'ok':True,'wifi':wifi_action(action,payload)}
    elif action.startswith('bt-'):
        result={'ok':True,'bluetooth':bt_action(action,payload)}
    else:
        fail('Unknown action')
    print(json.dumps(result, ensure_ascii=False))

if __name__=='__main__':
    main()
