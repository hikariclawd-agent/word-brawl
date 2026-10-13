"""Local-only integration race; isolated fixtures cleaned in finally. No external dependencies."""
import concurrent.futures, json, subprocess, uuid
CONTAINER = 'supabase_db_animal-name-place'
def sql(query):
    out = subprocess.run(['docker','exec','-i',CONTAINER,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],input=query,text=True,capture_output=True)
    if out.returncode: raise RuntimeError(out.stderr)
    return out.stdout.strip()
def literal(value): return "'" + json.dumps(value).replace("'","''") + "'::jsonb"
bucket='test:race:'+uuid.uuid4().hex
settings=dict(bot_count=0,bot_difficulty='Normal',categories=['Name','Place','Animal','Food','Object','Job','Brand'],match_duration_seconds=None,mode_label='Race',mode_rules='Test',round_seconds=90,scoring_owner='Opponents',scoring_style='Classic',target_rounds=3)
opts=dict(matchmakingBucket=bucket,rulesetVersion=1,minClientVersion='1.0.0')
def join(n):
    result=json.loads(sql("select find_or_create_public_room('race-device-%s','Race %s',%s,%s);"%(n,n,literal(settings),literal(opts))))
    result['devicePlayerId']='race-device-%s'%n
    return result
try:
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results=list(pool.map(join,range(8)))
    roomids={r['roomId'] for r in results}
    assert sql("select coalesce(bool_and(n<=5),false) from (select count(*) n from room_players where room_id in(select id from rooms where matchmaking_bucket='%s') group by room_id) s;"%bucket)=='t'
    # Force the deadline past, then race eight advance calls against the same room.
    a=max(results,key=lambda r:int(sql("select count(*) from room_players where room_id='%s' and role='player' and status='active';"%r['roomId'])))
    rid=a['roomId']; pid=a['playerId']; cap=a['capability']; device=a['devicePlayerId']
    sql("update rooms set live_brawl_seat_window_started_at=clock_timestamp()-interval '1 second' where id='%s';"%rid)
    def advance(_): return sql("select round_id from advance_live_brawl_session('%s','%s','A','%s','%s',60,5);"%(rid,pid,device,cap))
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool: rounds=list(pool.map(advance,range(8)))
    assert len(set(rounds))==1
    assert sql("select (select count(*) from room_players where room_id=r.id and role='player' and status='active')+bot_count <= 5 from rooms r where id='%s';"%rid)=='t'
    assert sql("select count(*) from rounds where room_id='%s';"%rid) in ('0','1')
    if not rounds[0]:
        while sql("select (select count(*) from room_players where room_id=r.id and role='player' and status='active')+bot_count from rooms r where id='%s';"%rid)!='5':
            sql("update rooms set live_brawl_seat_window_started_at=clock_timestamp()-interval '1 second' where id='%s';"%rid)
            round_id=advance(0)
        if not round_id:
            sql("update rooms set live_brawl_seat_window_started_at=clock_timestamp()-interval '1 second' where id='%s';"%rid)
            round_id=advance(0)
    else:
        round_id=rounds[0]
    assert round_id
    assert sql("select count(*) from rounds where room_id='%s';"%rid)=='1'
    # Late join must choose another lobby; it cannot alter this round roster.
    late=join(99); assert late['roomId']!=rid
    # Exercise concurrent persisted bots in a solo room (not an empty bot roster).
    solo=json.loads(sql("select create_managed_room('race-solo-device','Solo',%s,%s);"%(literal(settings),literal(dict(opts,visibility='public',maxPlayers=5)))))
    rid=solo['roomId']; pid=solo['playerId']; cap=solo['capability']; device='race-solo-device'
    for expected in range(1,5):
        sql("update rooms set live_brawl_seat_window_started_at=clock_timestamp()-interval '1 second' where id='%s';"%rid)
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            pool_rounds=list(pool.map(advance,range(8)))
        assert sql("select bot_count from rooms where id='%s';"%rid)==str(expected)
        assert len(set(pool_rounds))==1
    rounds=[pool_rounds[0]]
    assert rounds[0]
    sql("update rounds set status='revealing' where room_id='%s';"%rid)
    def snapshot(_): return sql("select get_online_bot_round_snapshot('%s','%s');"%(rid,rounds[0]))
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool: snapshots=list(pool.map(snapshot,range(8)))
    assert len(set(snapshots))==1
    print('PASS: 8 concurrent joins, 8 concurrent advances, target5, one round, late join exclusion, sequential bot fill, 8 identical snapshots')
finally:
    sql("delete from rooms where matchmaking_bucket='%s';"%bucket)
