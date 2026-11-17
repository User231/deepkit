// externals: throwBsonConversion_0, writeNameCString_0, writeStringUTF8_0, keys_0, fn_0, const_0, fn_1, const_1, fn_2
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
buffer[o_4]=4;
o_4+=1;
buffer[o_4]=116;
o_4+=1;
buffer[o_4]=97;
o_4+=1;
buffer[o_4]=103;
o_4+=1;
buffer[o_4]=115;
o_4+=1;
buffer[o_4]=0;
o_4+=1;
var arrStart_7=o_4;
view.setInt32(o_4,0,true);
o_4+=4;
for(var v9_arr=data.tags,v9=0,v9_end=v9_arr.length;v9<v9_end;v9++){
    var v8=v9_arr[v9];
    if((!("object"===typeof v8)||null===v8)){
        throwBsonConversion_0(v8,"tags.[i]","Tag");
    }
    buffer[o_4]=3;
    o_4+=1;
    o_4=writeNameCString_0(buffer,o_4,v9);
    var nestedStart_10=o_4;
    view.setInt32(o_4,0,true);
    o_4+=4;
    var typePos_11=o_4;
    o_4+=1;
    view.setUint32(o_4,25705,true);
    o_4+=3;
    if((v8.id|0)===v8.id){
        buffer[typePos_11]=16;
        view.setInt32(o_4,v8.id,true);
        o_4+=4;
    }else{
        buffer[typePos_11]=1;
        view.setFloat64(o_4,v8.id,true);
        o_4+=8;
    }
    if(!("string"===typeof v8.label)){
        throwBsonConversion_0(v8.label,"tags.[i].label","string");
    }
    view.setUint32(o_4,1650551810,true);
    o_4+=4;
    view.setUint32(o_4,27749,true);
    o_4+=3;
    var strLenPos_12=o_4;
    o_4+=4;
    var strStart_13=o_4;
    o_4=writeStringUTF8_0(buffer,o_4,v8.label);
    buffer[o_4]=0;
    o_4+=1;
    view.setInt32(strLenPos_12,(o_4-strStart_13),true);
    buffer[o_4]=0;
    o_4+=1;
    view.setInt32(nestedStart_10,(o_4-nestedStart_10),true);
}
buffer[o_4]=0;
o_4+=1;
view.setInt32(arrStart_7,(o_4-arrStart_7),true);
if((!("object"===typeof data.meta)||null===data.meta)){
    throwBsonConversion_0(data.meta,"meta","Record<string, string | number>");
}
buffer[o_4]=3;
o_4+=1;
buffer[o_4]=109;
o_4+=1;
buffer[o_4]=101;
o_4+=1;
buffer[o_4]=116;
o_4+=1;
buffer[o_4]=97;
o_4+=1;
buffer[o_4]=0;
o_4+=1;
var nestedStart_14=o_4;
view.setInt32(o_4,0,true);
o_4+=4;
var keys_15=keys_0(data.meta);
for(var v17_arr=keys_15,v17=0,v17_end=v17_arr.length;v17<v17_end;v17++){
    var v16=v17_arr[v17];
    if(data.meta[v16]!==undefined){
        var unionMatched_18=false;
        if(!(unionMatched_18)){
            if("number"===typeof data.meta[v16]){
                var typePos_19=o_4;
                o_4+=1;
                o_4=writeNameCString_0(buffer,o_4,v16);
                if((data.meta[v16]|0)===data.meta[v16]){
                    buffer[typePos_19]=16;
                    view.setInt32(o_4,data.meta[v16],true);
                    o_4+=4;
                }else{
                    buffer[typePos_19]=1;
                    view.setFloat64(o_4,data.meta[v16],true);
                    o_4+=8;
                }
                unionMatched_18=true;
            }
        }
        if(!(unionMatched_18)){
            if("string"===typeof data.meta[v16]){
                if(!("string"===typeof data.meta[v16])){
                    throwBsonConversion_0(data.meta[v16],"meta.[key]","string");
                }
                buffer[o_4]=2;
                o_4+=1;
                o_4=writeNameCString_0(buffer,o_4,v16);
                var strLenPos_20=o_4;
                o_4+=4;
                var strStart_21=o_4;
                o_4=writeStringUTF8_0(buffer,o_4,data.meta[v16]);
                buffer[o_4]=0;
                o_4+=1;
                view.setInt32(strLenPos_20,(o_4-strStart_21),true);
                unionMatched_18=true;
            }
        }
        if(!(unionMatched_18)){
            fn_0(data.meta[v16],const_0,"meta.[key]");
        }
    }
}
buffer[o_4]=0;
o_4+=1;
view.setInt32(nestedStart_14,(o_4-nestedStart_14),true);
var unionMatched_22=false;
if(!(unionMatched_22)){
    if(data.state==="draft"){
        view.setUint32(o_4,1635021570,true);
        o_4+=4;
        view.setUint32(o_4,25972,true);
        o_4+=3;
        var strLenPos_23=o_4;
        o_4+=4;
        var strStart_24=o_4;
        o_4=writeStringUTF8_0(buffer,o_4,data.state);
        buffer[o_4]=0;
        o_4+=1;
        view.setInt32(strLenPos_23,(o_4-strStart_24),true);
        unionMatched_22=true;
    }
}
if(!(unionMatched_22)){
    if(data.state==="live"){
        view.setUint32(o_4,1635021570,true);
        o_4+=4;
        view.setUint32(o_4,25972,true);
        o_4+=3;
        var strLenPos_25=o_4;
        o_4+=4;
        var strStart_26=o_4;
        o_4=writeStringUTF8_0(buffer,o_4,data.state);
        buffer[o_4]=0;
        o_4+=1;
        view.setInt32(strLenPos_25,(o_4-strStart_26),true);
        unionMatched_22=true;
    }
}
if(!(unionMatched_22)){
    if(data.state==="gone"){
        view.setUint32(o_4,1635021570,true);
        o_4+=4;
        view.setUint32(o_4,25972,true);
        o_4+=3;
        var strLenPos_27=o_4;
        o_4+=4;
        var strStart_28=o_4;
        o_4=writeStringUTF8_0(buffer,o_4,data.state);
        buffer[o_4]=0;
        o_4+=1;
        view.setInt32(strLenPos_27,(o_4-strStart_28),true);
        unionMatched_22=true;
    }
}
if(!(unionMatched_22)){
    fn_1(data.state,const_1,"state");
}
switch(data.shape.kind){
    case "circle":{
        if((!("object"===typeof data.shape)||null===data.shape)){
            throwBsonConversion_0(data.shape,"shape","{\n  kind: 'circle';\n  r: number;\n}");
        }
        view.setUint32(o_4,1634235139,true);
        o_4+=4;
        view.setUint32(o_4,25968,true);
        o_4+=3;
        var nestedStart_29=o_4;
        view.setInt32(o_4,0,true);
        o_4+=4;
        buffer[o_4]=2;
        o_4+=1;
        buffer[o_4]=107;
        o_4+=1;
        buffer[o_4]=105;
        o_4+=1;
        buffer[o_4]=110;
        o_4+=1;
        buffer[o_4]=100;
        o_4+=1;
        buffer[o_4]=0;
        o_4+=1;
        var strLenPos_30=o_4;
        o_4+=4;
        var strStart_31=o_4;
        o_4=writeStringUTF8_0(buffer,o_4,data.shape.kind);
        buffer[o_4]=0;
        o_4+=1;
        view.setInt32(strLenPos_30,(o_4-strStart_31),true);
        var typePos_32=o_4;
        o_4+=1;
        view.setUint32(o_4,114,true);
        o_4+=2;
        if((data.shape.r|0)===data.shape.r){
            buffer[typePos_32]=16;
            view.setInt32(o_4,data.shape.r,true);
            o_4+=4;
        }else{
            buffer[typePos_32]=1;
            view.setFloat64(o_4,data.shape.r,true);
            o_4+=8;
        }
        buffer[o_4]=0;
        o_4+=1;
        view.setInt32(nestedStart_29,(o_4-nestedStart_29),true);
    break;}
    case "rect":{
        if((!("object"===typeof data.shape)||null===data.shape)){
            throwBsonConversion_0(data.shape,"shape","{\n  kind: 'rect';\n  w: number;\n  h: number;\n}");
        }
        view.setUint32(o_4,1634235139,true);
        o_4+=4;
        view.setUint32(o_4,25968,true);
        o_4+=3;
        var nestedStart_33=o_4;
        view.setInt32(o_4,0,true);
        o_4+=4;
        buffer[o_4]=2;
        o_4+=1;
        buffer[o_4]=107;
        o_4+=1;
        buffer[o_4]=105;
        o_4+=1;
        buffer[o_4]=110;
        o_4+=1;
        buffer[o_4]=100;
        o_4+=1;
        buffer[o_4]=0;
        o_4+=1;
        var strLenPos_34=o_4;
        o_4+=4;
        var strStart_35=o_4;
        o_4=writeStringUTF8_0(buffer,o_4,data.shape.kind);
        buffer[o_4]=0;
        o_4+=1;
        view.setInt32(strLenPos_34,(o_4-strStart_35),true);
        var typePos_36=o_4;
        o_4+=1;
        view.setUint32(o_4,119,true);
        o_4+=2;
        if((data.shape.w|0)===data.shape.w){
            buffer[typePos_36]=16;
            view.setInt32(o_4,data.shape.w,true);
            o_4+=4;
        }else{
            buffer[typePos_36]=1;
            view.setFloat64(o_4,data.shape.w,true);
            o_4+=8;
        }
        var typePos_37=o_4;
        o_4+=1;
        view.setUint32(o_4,104,true);
        o_4+=2;
        if((data.shape.h|0)===data.shape.h){
            buffer[typePos_37]=16;
            view.setInt32(o_4,data.shape.h,true);
            o_4+=4;
        }else{
            buffer[typePos_37]=1;
            view.setFloat64(o_4,data.shape.h,true);
            o_4+=8;
        }
        buffer[o_4]=0;
        o_4+=1;
        view.setInt32(nestedStart_33,(o_4-nestedStart_33),true);
    break;}
    default:{
        fn_2("kind",data.shape.kind,"shape");
    break;}
}
if((!("object"===typeof data.owner)||null===data.owner)){
    throwBsonConversion_0(data.owner,"owner","{\n  id: number;\n  names: Array<string>;\n}");
}
view.setUint32(o_4,1853320963,true);
o_4+=4;
view.setUint32(o_4,29285,true);
o_4+=3;
var nestedStart_38=o_4;
view.setInt32(o_4,0,true);
o_4+=4;
var typePos_39=o_4;
o_4+=1;
view.setUint32(o_4,25705,true);
o_4+=3;
if((data.owner.id|0)===data.owner.id){
    buffer[typePos_39]=16;
    view.setInt32(o_4,data.owner.id,true);
    o_4+=4;
}else{
    buffer[typePos_39]=1;
    view.setFloat64(o_4,data.owner.id,true);
    o_4+=8;
}
view.setUint32(o_4,1835101700,true);
o_4+=4;
view.setUint32(o_4,29541,true);
o_4+=3;
var arrStart_40=o_4;
view.setInt32(o_4,0,true);
o_4+=4;
for(var v42_arr=data.owner.names,v42=0,v42_end=v42_arr.length;v42<v42_end;v42++){
    var v41=v42_arr[v42];
    if(!("string"===typeof v41)){
        throwBsonConversion_0(v41,"owner.names.[i]","string");
    }
    buffer[o_4]=2;
    o_4+=1;
    o_4=writeNameCString_0(buffer,o_4,v42);
    var strLenPos_43=o_4;
    o_4+=4;
    var strStart_44=o_4;
    o_4=writeStringUTF8_0(buffer,o_4,v41);
    buffer[o_4]=0;
    o_4+=1;
    view.setInt32(strLenPos_43,(o_4-strStart_44),true);
}
buffer[o_4]=0;
o_4+=1;
view.setInt32(arrStart_40,(o_4-arrStart_40),true);
buffer[o_4]=0;
o_4+=1;
view.setInt32(nestedStart_38,(o_4-nestedStart_38),true);
buffer[o_4]=0;
o_4+=1;
view.setInt32(start_5,(o_4-start_5),true);
return o_4;
}
