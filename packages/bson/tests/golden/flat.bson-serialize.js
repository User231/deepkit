// externals: throwBsonConversion_0, writeStringUTF8_0, fn_0
'use strict';
return function(buffer,view,offset,data){
var o_4=offset;
var start_5=o_4;
view.setInt32(o_4,0,true);
o_4+=4;
var typePos_6=o_4;
o_4+=1;
view.setUint32(o_4,25705,true);
o_4+=3;
if((data.id|0)===data.id){
    buffer[typePos_6]=16;
    view.setInt32(o_4,data.id,true);
    o_4+=4;
}else{
    buffer[typePos_6]=1;
    view.setFloat64(o_4,data.id,true);
    o_4+=8;
}
if(!("string"===typeof data.name)){
    throwBsonConversion_0(data.name,"name","string");
}
buffer[o_4]=2;
o_4+=1;
buffer[o_4]=110;
o_4+=1;
buffer[o_4]=97;
o_4+=1;
buffer[o_4]=109;
o_4+=1;
buffer[o_4]=101;
o_4+=1;
buffer[o_4]=0;
o_4+=1;
var strLenPos_7=o_4;
o_4+=4;
var strStart_8=o_4;
o_4=writeStringUTF8_0(buffer,o_4,data.name);
buffer[o_4]=0;
o_4+=1;
view.setInt32(strLenPos_7,(o_4-strStart_8),true);
view.setBigInt64(o_4,28559167944089864n,true);
o_4+=8;
buffer[o_4]=(data.active?1:0);
o_4+=1;
if(fn_0(data,"note")){
    if(data.note==null){
        buffer[o_4]=10;
        o_4+=1;
        buffer[o_4]=110;
        o_4+=1;
        buffer[o_4]=111;
        o_4+=1;
        buffer[o_4]=116;
        o_4+=1;
        buffer[o_4]=101;
        o_4+=1;
        buffer[o_4]=0;
        o_4+=1;
    }else{
        if(!("string"===typeof data.note)){
            throwBsonConversion_0(data.note,"note","string");
        }
        buffer[o_4]=2;
        o_4+=1;
        buffer[o_4]=110;
        o_4+=1;
        buffer[o_4]=111;
        o_4+=1;
        buffer[o_4]=116;
        o_4+=1;
        buffer[o_4]=101;
        o_4+=1;
        buffer[o_4]=0;
        o_4+=1;
        var strLenPos_9=o_4;
        o_4+=4;
        var strStart_10=o_4;
        o_4=writeStringUTF8_0(buffer,o_4,data.note);
        buffer[o_4]=0;
        o_4+=1;
        view.setInt32(strLenPos_9,(o_4-strStart_10),true);
    }
}
if((data.score===null||data.score===undefined)){
    view.setUint32(o_4,1868788490,true);
    o_4+=4;
    view.setUint32(o_4,25970,true);
    o_4+=3;
}else{
    var typePos_11=o_4;
    o_4+=1;
    buffer[o_4]=115;
    o_4+=1;
    buffer[o_4]=99;
    o_4+=1;
    buffer[o_4]=111;
    o_4+=1;
    buffer[o_4]=114;
    o_4+=1;
    buffer[o_4]=101;
    o_4+=1;
    buffer[o_4]=0;
    o_4+=1;
    if((data.score|0)===data.score){
        buffer[typePos_11]=16;
        view.setInt32(o_4,data.score,true);
        o_4+=4;
    }else{
        buffer[typePos_11]=1;
        view.setFloat64(o_4,data.score,true);
        o_4+=8;
    }
}
buffer[o_4]=0;
o_4+=1;
view.setInt32(start_5,(o_4-start_5),true);
return o_4;
}
