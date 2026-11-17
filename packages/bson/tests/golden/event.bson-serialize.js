// externals: floor_0, throwBsonConversion_0, writeStringUTF8_0, fn_0
'use strict';
return function(buffer,view,offset,data){
var o_4=offset;
var start_5=o_4;
view.setInt32(o_4,0,true);
o_4+=4;
if(null!=data.id){
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
}
if(null!=data.at){
    view.setUint32(o_4,7627017,true);
    o_4+=4;
    var ms_7=data.at.getTime();
    view.setUint32(o_4,(ms_7>>>0),true);
    view.setInt32((o_4+4),floor_0((ms_7/4294967296)),true);
    o_4+=8;
}
if(null!=data.big){
    buffer[o_4]=18;
    o_4+=1;
    view.setUint32(o_4,6777186,true);
    o_4+=4;
    view.setBigInt64(o_4,data.big,true);
    o_4+=8;
}
if(null!=data.bytes){
    view.setUint32(o_4,1954112005,true);
    o_4+=4;
    view.setUint32(o_4,29541,true);
    o_4+=3;
    var len_8=data.bytes.length;
    view.setInt32(o_4,len_8,true);
    o_4+=4;
    buffer[o_4]=0;
    o_4+=1;
    buffer.set(data.bytes,o_4);
    o_4+=len_8;
}
if(null!=data.title){
    if(!("string"===typeof data.title)){
        throwBsonConversion_0(data.title,"title","string");
    }
    view.setUint32(o_4,1953068034,true);
    o_4+=4;
    view.setUint32(o_4,25964,true);
    o_4+=3;
    var strLenPos_9=o_4;
    o_4+=4;
    var strStart_10=o_4;
    o_4=writeStringUTF8_0(buffer,o_4,data.title);
    buffer[o_4]=0;
    o_4+=1;
    view.setInt32(strLenPos_9,(o_4-strStart_10),true);
}
if(fn_0(data,"until")){
    if(data.until==null){
        view.setUint32(o_4,1953395978,true);
        o_4+=4;
        view.setUint32(o_4,27753,true);
        o_4+=3;
    }else{
        view.setUint32(o_4,1953395977,true);
        o_4+=4;
        view.setUint32(o_4,27753,true);
        o_4+=3;
        var ms_11=data.until.getTime();
        view.setUint32(o_4,(ms_11>>>0),true);
        view.setInt32((o_4+4),floor_0((ms_11/4294967296)),true);
        o_4+=8;
    }
}
buffer[o_4]=0;
o_4+=1;
view.setInt32(start_5,(o_4-start_5),true);
return o_4;
}
