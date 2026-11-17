// ── let: binds once
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
var v4=(v0+1);
return [v4,v4];
}

// ── let: name that is no identifier
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
var _1_odd_name_4=v0;
return _1_odd_name_4;
}

// ── set: identifier key
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
v2.added=v0;
return v2;
}

// ── set: key that is no identifier
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
v2["needs-quotes"]=v0;
return v2;
}

// ── set: computed key
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
v2[("k"+v0)]=v1;
return v2;
}

// ── set: on a fresh object literal
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
({a:v0}).lost=v0;
return v0;
}

// ── push: onto an input
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
v3.push(v0);
return v3.length;
}

// ── push: onto a fresh array literal
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
[v0].push(v0);
return v0;
}

// ── setVar: plain assignment
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
var v4=0;
v4=v0;
return v4;
}

// ── setVar: add one to a number, a string, a bigint
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
var v4=1;
var v5="a";
v4+=1;
v5+=1;
return [v4,v5,v0];
}

// ── setVar: subtract one
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
var v4=1;
var v5="7";
v4-=1;
v5-=1;
return [v4,v5,v0];
}

// ── setVar: add one to the input itself
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
var v4=v0;
v4+=1;
return v4;
}

// ── setVar: every compound operator
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
var v4=v0;
var v5=[];
v4+=3;
v5.push(v4);
v4=v0;
v4-=3;
v5.push(v4);
v4=v0;
v4*=3;
v5.push(v4);
v4=v0;
v4/=3;
v5.push(v4);
v4=v0;
v4%=3;
v5.push(v4);
v4=v0;
v4&=3;
v5.push(v4);
v4=v0;
v4|=3;
v5.push(v4);
v4=v0;
v4^=3;
v5.push(v4);
v4=v0;
v4<<=3;
v5.push(v4);
v4=v0;
v4>>=3;
v5.push(v4);
v4=v0;
v4>>>=3;
v5.push(v4);
v4=v0;
return v5;
}

// ── setVar: operand order is kept
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
var v4=10;
v4=(v0-v4);
return v4;
}

// ── exec: a call
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
v1.push(v0);
return v1;
}

// ── exec: an object literal
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
({a:v1.push(v0)});
({[(""+v0)]:v0});
return v1;
}

// ── return: a value
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0+1);
}

// ── return: nothing
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
v1.push("before");
return;
}

// ── return: skips the rest
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0;
v1.push("never");
return "never";
}

// ── throw: a value
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
throw ["thrown",v0];
}

// ── throw: an error
// externals: RangeError_0
'use strict';
return function(v0,v1,v2,v3){
throw new RangeError_0("out of range");
}

// ── if: then and else
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
if(v0>1){
    v1.push("then");
}else{
    v1.push("else");
}
return v1;
}

// ── if: branch that returns
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
if(v0>1){
    return "early";
}
return "late";
}

// ── if: condition chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
if(v0===1){
    return "one";
}else{
    if(v0===2){
        return "two";
    }else{
        return "many";
    }
}
}

// ── loop: elements and indices
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
for(var at_5=0,at_5_end=v3.length;at_5<at_5_end;at_5++){
    var el_4=v3[at_5];
    v1.push([el_4,at_5]);
}
return v1;
}

// ── loop: index only
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
for(var v5=0,v5_end=v3.length;v5<v5_end;v5++){
    v1.push(v3[v5]);
}
return v1;
}

// ── loop: range
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
for(var v4=v0,v4_end=6;v4<v4_end;v4++){
    v1.push(v4);
}
return v1;
}

// ── loop: range over an array
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
for(var v4=1,v4_end=v3.length;v4<v4_end;v4++){
    var v5=v3[v4];
    v1.push([v4,v5]);
}
return v1;
}

// ── loop: source is read once
// externals: noteRead_0
'use strict';
return function(v0,v1,v2,v3){
for(var v5_arr=noteRead_0(v3),v5=0,v5_end=v5_arr.length;v5<v5_end;v5++){
    var v4=v5_arr[v5];
    v1.push(v4);
}
return v3;
}

// ── loop: array that grows while looping
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
for(var v5=0,v5_end=v3.length;v5<v5_end;v5++){
    var v4=v3[v5];
    v3.push("grown");
    v1.push(v4);
}
return v1;
}

// ── forIn: keys and values
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
for(var key_4 in v2){
    v1.push([key_4,v2[key_4]]);
}
return v1;
}

// ── forIn: over an array
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
for(var v4 in v3){
    v1.push(v4);
}
return v1;
}

// ── forOf: values
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
for(var item_4 of v3){
    v1.push(item_4);
}
return v1;
}

// ── forOf: a Set
// externals: const_0
'use strict';
return function(v0,v1,v2,v3){
for(var v4 of const_0){
    v1.push(v4);
}
return v1;
}

// ── forOf: Map entries
// externals: const_0
'use strict';
return function(v0,v1,v2,v3){
for(var [k_5,v_4] of const_0){
    v1.push([k_5,v_4]);
}
return v1;
}

// ── switch: case that returns
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
switch(v0){
    case 1:{
        return "one";
    break;}
    case 2:{
        return "two";
    break;}
    default:{
        return "default";
    break;}
}
}

// ── switch: falls out to the code after
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
switch(v0){
    case 1:{
        v1.push("one");
    break;}
    case 2:{
        v1.push("two");
    break;}
}
v1.push("after");
return v1;
}

// ── switch: case literals of every primitive type
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
switch(v0){
    case "1":{
        return "string one";
    break;}
    case 1n:{
        return "bigint one";
    break;}
    case -1:{
        return "minus one";
    break;}
    case true:{
        return "true";
    break;}
    case null:{
        return "null";
    break;}
    case undefined:{
        return "undefined";
    break;}
    case "it's \"quoted\"\n":{
        return "quoted";
    break;}
    case 1:{
        return "number one";
    break;}
    default:{
        return "default";
    break;}
}
}

// ── switch: case literal that is an object
// externals: const_0
'use strict';
return function(v0,v1,v2,v3){
switch(v0){
    case const_0:{
        return "the object";
    break;}
    default:{
        return "default";
    break;}
}
}

// ── while: counts up
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
var v4=0;
while(v4<3){
    v1.push(v4);
    v4+=1;
}
return v1;
}

// ── break: leaves a while loop
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
var v4=0;
while(v4<6){
    v4+=1;
    if(v4>v0){
        break;
    }
    v1.push(v4);
}
return v1;
}

// ── break: leaves an array loop
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
for(var v5=0,v5_end=v3.length;v5<v5_end;v5++){
    var v4=v3[v5];
    if(v5===v0){
        break;
    }
    v1.push(v4);
}
return v1;
}

// ── continue: skips in a while loop
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
var v4=0;
while(v4<4){
    v4+=1;
    if(v4===v0){
        continue;
    }
    v1.push(v4);
}
return v1;
}

// ── continue: skips in an array loop
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
for(var v5=0,v5_end=v3.length;v5<v5_end;v5++){
    var v4=v3[v5];
    if(v5===v0){
        continue;
    }
    v1.push(v4);
}
return v1;
}

// ── await: a promise
// externals: resolved_0
'use strict';
return async function(v0,v1,v2,v3){
var v4=await resolved_0(v0);
return v4;
}

// ── await: a value that is no promise
// externals: (none)
'use strict';
return async function(v0,v1,v2,v3){
var v4=await v0;
return v4;
}

// ── await: a promise that settles later
// externals: later_0
'use strict';
return async function(v0,v1,v2,v3){
var v4=await later_0(v0);
return v4;
}

// ── await: a thenable
// externals: thenable_0
'use strict';
return async function(v0,v1,v2,v3){
var v4=await thenable_0(v0);
return v4;
}

// ── await: a rejection
// externals: rejected_0
'use strict';
return async function(v0,v1,v2,v3){
var v4=await rejected_0(v0);
return "never";
}

// ── await: named, and read twice
// externals: resolved_0
'use strict';
return async function(v0,v1,v2,v3){
var got_it_4=await resolved_0(v0);
return [got_it_4,got_it_4];
}

// ── await: the result is not used
// externals: resolved_0
'use strict';
return async function(v0,v1,v2,v3){
var v4=await resolved_0(v1.push(v0));
return v1;
}

// ── await: in a loop, in order
// externals: later_0
'use strict';
return async function(v0,v1,v2,v3){
for(var v5=0,v5_end=v3.length;v5<v5_end;v5++){
    var v4=v3[v5];
    var v6=await later_0(v4);
    v1.push(v6);
}
return v1;
}

// ── await: an operand that is a comparison
// externals: (none)
'use strict';
return async function(v0,v1,v2,v3){
var v4=await (v0===1);
return v4;
}

// ── try: catches what the body throws
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
try{
    if(v0===1){
        throw ["thrown",v0];
    }
    v1.push("body ran to its end");
}catch(the_error_4_caught){
    var the_error_4=the_error_4_caught;
    v1.push(the_error_4);
}
return v1;
}

// ── try: catches an error of the engine
// externals: TypeError_0
'use strict';
return function(v0,v1,v2,v3){
try{
    v1.push(v0.missing.deeper);
}catch(v4_caught){
    var v4=v4_caught;
    v1.push((v4 instanceof TypeError_0));
}
return v1;
}

// ── try: finally, with nothing thrown and with something
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
try{
    if(v0===2){
        throw "thrown";
    }
    v1.push("body");
}catch(v4_caught){
    var v4=v4_caught;
    v1.push(v4);
}finally{
    v1.push("finally");
}
return v1;
}

// ── try: finally without a catch lets the error on
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
try{
    if(v0===1){
        throw v1;
    }
}finally{
    v1.push("finally");
}
return v1;
}

// ── try: a return in the body runs the finally and keeps its value
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
try{
    return ["returned",v0];
}finally{
    v1.push("finally");
}
return "never";
}

// ── try: a return in the catch
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
try{
    throw v0;
}catch(v4_caught){
    var v4=v4_caught;
    return ["caught",v4];
}
return "never";
}

// ── try: a finally that returns replaces a return and an error
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
try{
    if(v0===1){
        throw "lost";
    }
    return "lost too";
}finally{
    return ["finally wins",v0];
}
}

// ── try: a finally that throws replaces a return
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
try{
    return "lost";
}finally{
    if(v0===2){
        throw "from finally";
    }
}
}

// ── try: a catch that throws still runs the finally
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
try{
    throw "first";
}catch(v4_caught){
    var v4=v4_caught;
    v1.push(v4);
    throw ["second",v1];
}finally{
    v1.push("finally");
}
}

// ── try: break and continue leave through the finally
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
for(var v5=0,v5_end=v3.length;v5<v5_end;v5++){
    var v4=v3[v5];
    try{
        if(v5===v0){
            break;
        }
        if(v5===0){
            continue;
        }
        v1.push(v4);
    }finally{
        v1.push("finally");
    }
    v1.push("after");
}
return v1;
}

// ── try: one inside another
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
try{
    try{
        throw ["inner",v0];
    }catch(v4_caught){
        var v4=v4_caught;
        v1.push(v4);
        if(v0===1){
            throw "rethrown";
        }
    }finally{
        v1.push("inner finally");
    }
    v1.push("between");
}catch(v5_caught){
    var v5=v5_caught;
    v1.push(["outer",v5]);
}finally{
    v1.push("outer finally");
}
return v1;
}

// ── try: the caught value is a variable of the function
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
try{
    if(v0===1){
        throw "thrown";
    }
}catch(v4_caught){
    var v4=v4_caught;
}
return [v4];
}

// ── try: the value of a return waits while the finally calls a function that returns
// externals: (none)
'use strict';
function _nfn_0(v0){
v0.push("called");
return "the callee returned this";
}
return function(v0,v1,v2,v3){
try{
    return ["mine",v0];
}finally{
    _nfn_0(v1);
}
}
